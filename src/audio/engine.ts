import { clamp, defaultSynthSettings, midiFrequency, type SynthSettings } from "../model/config";

interface Voice {
  id: number;
  note: number;
  startedAt: number;
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  oscillatorParts: OscillatorPart[];
  envelope: GainNode;
  volumeVca: GainNode;
  pitchLfo: LfoNodes | null;
  volumeLfo: LfoNodes;
  peak: number;
  sustain: number;
  attack: number;
  decay: number;
  release: number;
  released: boolean;
  releaseStartedAt: number | null;
  releaseStartLevel: number;
  releaseEndAt: number | null;
  activeSources: number;
}

interface OscillatorPart {
  index: 0 | 1;
  source: OscillatorNode | AudioBufferSourceNode;
  oscillator: OscillatorNode | null;
  gain: GainNode;
  filter: BiquadFilterNode | null;
  baseFrequency: number;
}

interface LfoNodes {
  source: OscillatorNode;
  depth: GainNode;
}

export class AudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private settings: SynthSettings = structuredClone(defaultSynthSettings);
  private voices = new Map<number, Voice>();
  private nextVoiceId = 0;

  get isRunning(): boolean {
    return this.context?.state === "running";
  }

  get currentTime(): number {
    return this.context?.currentTime ?? 0;
  }

  get audioContext(): AudioContext {
    if (!this.context) throw new Error("音声の準備を先に行ってください。");
    return this.context;
  }

  get output(): GainNode {
    if (!this.master) throw new Error("音声の準備を先に行ってください。");
    return this.master;
  }

  async start(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.context.destination);
    }
    await this.context.resume();
  }

  setSettings(settings: SynthSettings): void {
    this.settings = structuredClone(settings);
    if (!this.context) return;
    const now = this.context.currentTime;
    for (const voice of this.voices.values()) {
      for (const part of voice.oscillatorParts) {
        const oscillator = this.settings.oscillators[part.index];
        part.gain.gain.setTargetAtTime(oscillator.volume, now, 0.015);
        if (oscillator.waveform === "noise" && part.oscillator) {
          this.replaceOscillatorWithNoise(voice, part, oscillator.semitones, oscillator.cents, now);
        } else if (oscillator.waveform !== "noise" && !part.oscillator) {
          this.replaceNoiseWithOscillator(voice, part, oscillator, now);
        } else if (part.oscillator && oscillator.waveform !== "noise") {
          part.oscillator.type = oscillator.waveform;
          part.oscillator.frequency.setTargetAtTime(this.oscillatorFrequency(part.baseFrequency, oscillator.semitones), now, 0.015);
          part.oscillator.detune.setTargetAtTime(oscillator.cents, now, 0.015);
        } else if (part.filter) {
          part.filter.frequency.setTargetAtTime(this.noiseCutoff(part.baseFrequency, oscillator.semitones, oscillator.cents), now, 0.015);
        }
      }
      if (voice.pitchLfo) {
        voice.pitchLfo.source.type = this.settings.pitchLfo.waveform;
        voice.pitchLfo.source.frequency.setTargetAtTime(this.settings.pitchLfo.frequency, now, 0.015);
        voice.pitchLfo.depth.gain.setTargetAtTime(this.settings.pitchLfo.enabled ? this.settings.pitchLfo.depth : 0, now, 0.015);
      }
      voice.volumeLfo.source.type = this.settings.volumeLfo.waveform;
      voice.volumeLfo.source.frequency.setTargetAtTime(this.settings.volumeLfo.frequency, now, 0.015);
      voice.volumeLfo.depth.gain.setTargetAtTime(this.settings.volumeLfo.enabled ? this.settings.volumeLfo.depth : 0, now, 0.015);
      voice.volumeVca.gain.setTargetAtTime(this.settings.volumeLfo.enabled ? 1 - this.settings.volumeLfo.depth : 1, now, 0.015);
      this.updateVoiceEnvelope(voice, now);
    }
  }

  noteOn(note: number, velocity = 100, at?: number): number | null {
    if (!this.context || this.context.state !== "running" || !this.master) return null;
    const now = Math.max(this.context.currentTime, at ?? this.context.currentTime);
    if (this.voices.size >= this.settings.polyphony) {
      const oldest = [...this.voices.values()].sort((a, b) => a.startedAt - b.startedAt)[0];
      if (oldest) this.disposeVoice(oldest);
    }

    const id = this.nextVoiceId++;
    const envelope = this.context.createGain();
    const amp = clamp(velocity / 127, 0, 1);
    const { attack, decay, sustain } = this.settings.envelope;
    const oscillatorVolume = this.settings.oscillators.reduce((total, oscillator) => total + oscillator.volume, 0);
    const mixHeadroom = Math.min(1, 0.75 / Math.max(0.75, oscillatorVolume));
    const polyphonyHeadroom = Math.sqrt(8 / this.settings.polyphony);
    const peak = amp * 0.18 * mixHeadroom * polyphonyHeadroom;
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(peak, now + attack);
    envelope.gain.linearRampToValueAtTime(peak * sustain, now + attack + decay);

    const nodes: AudioNode[] = [envelope];
    const sources: AudioScheduledSourceNode[] = [];
    const oscillatorParts: OscillatorPart[] = [];
    const pitchTargets: AudioParam[] = [];
    const volumeVca = this.context.createGain();
    volumeVca.gain.value = this.settings.volumeLfo.enabled ? 1 - this.settings.volumeLfo.depth : 1;
    envelope.connect(volumeVca);
    volumeVca.connect(this.master);
    nodes.push(volumeVca);
    const baseFrequency = midiFrequency(note);
    for (const [index, oscillator] of this.settings.oscillators.entries()) {
      const oscillatorGain = this.context.createGain();
      oscillatorGain.gain.value = oscillator.volume;
      oscillatorGain.connect(envelope);
      nodes.push(oscillatorGain);

      const frequency = this.oscillatorFrequency(baseFrequency, oscillator.semitones);
      if (oscillator.waveform === "noise") {
        const noise = this.createNoiseSource();
        const filter = this.context.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = this.noiseCutoff(baseFrequency, oscillator.semitones, oscillator.cents);
        noise.connect(filter);
        filter.connect(oscillatorGain);
        nodes.push(filter);
        noise.start(now);
        sources.push(noise);
        oscillatorParts.push({ index: index as 0 | 1, source: noise, oscillator: null, gain: oscillatorGain, filter, baseFrequency });
      } else {
        const source = this.context.createOscillator();
        source.type = oscillator.waveform;
        source.frequency.setValueAtTime(frequency, now);
        source.detune.setValueAtTime(oscillator.cents, now);
        source.connect(oscillatorGain);
        source.start(now);
        sources.push(source);
        pitchTargets.push(source.detune);
        oscillatorParts.push({ index: index as 0 | 1, source, oscillator: source, gain: oscillatorGain, filter: null, baseFrequency });
      }
    }

    const lfos = this.addLfo(nodes, sources, pitchTargets, volumeVca, now);
    const voice: Voice = {
      id, note, startedAt: now, sources, nodes, oscillatorParts, envelope, volumeVca,
      pitchLfo: lfos.pitch, volumeLfo: lfos.volume, peak, sustain,
      attack, decay, release: this.settings.envelope.release, released: false,
      releaseStartedAt: null, releaseStartLevel: 0, releaseEndAt: null, activeSources: 0
    };
    this.voices.set(id, voice);
    for (const source of sources) this.trackSource(voice, source);
    return id;
  }

  noteOff(id: number, at?: number): void {
    const voice = this.voices.get(id);
    if (!voice || voice.released || !this.context) return;
    voice.released = true;
    const now = Math.max(this.context.currentTime, at ?? this.context.currentTime);
    const currentLevel = this.envelopeAt(voice, now);
    const releaseEnd = now + Math.max(0.015, voice.release);
    voice.releaseStartedAt = now;
    voice.releaseStartLevel = currentLevel;
    voice.releaseEndAt = releaseEnd;
    const gain = voice.envelope.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(currentLevel, now);
    gain.linearRampToValueAtTime(0, releaseEnd);
    for (const source of voice.sources) {
      try {
        source.stop(releaseEnd + 0.03);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "InvalidStateError")) throw error;
      }
    }
    if (voice.sources.length === 0) this.disposeVoice(voice);
  }

  releaseAll(): void {
    for (const voice of [...this.voices.values()]) this.disposeVoice(voice);
  }

  async stop(): Promise<void> {
    if (!this.context) return;
    this.releaseAll();
    await this.context.suspend();
  }

  private addLfo(
    nodes: AudioNode[],
    sources: AudioScheduledSourceNode[],
    pitchTargets: AudioParam[],
    volumeVca: GainNode,
    now: number
  ): { pitch: LfoNodes | null; volume: LfoNodes } {
    if (!this.context) throw new Error("AudioContext has not started.");
    const { pitchLfo, volumeLfo } = this.settings;
    const pitchSource = this.context.createOscillator();
    const pitchDepth = this.context.createGain();
    pitchSource.type = pitchLfo.waveform;
    pitchSource.frequency.setValueAtTime(pitchLfo.frequency, now);
    pitchDepth.gain.setValueAtTime(pitchLfo.enabled ? pitchLfo.depth : 0, now);
    pitchSource.connect(pitchDepth);
    for (const target of pitchTargets) pitchDepth.connect(target);
    pitchSource.start(now);
    sources.push(pitchSource);
    nodes.push(pitchDepth);
    const pitch = { source: pitchSource, depth: pitchDepth };
    const lfo = this.context.createOscillator();
    const depth = this.context.createGain();
    lfo.type = volumeLfo.waveform;
    lfo.frequency.setValueAtTime(volumeLfo.frequency, now);
    depth.gain.setValueAtTime(volumeLfo.enabled ? volumeLfo.depth : 0, now);
    lfo.connect(depth);
    depth.connect(volumeVca.gain);
    lfo.start(now);
    sources.push(lfo);
    nodes.push(depth);
    return { pitch, volume: { source: lfo, depth } };
  }

  private oscillatorFrequency(baseFrequency: number, semitones: number): number {
    if (!this.context) return baseFrequency;
    return clamp(
      baseFrequency * 2 ** (semitones / 12),
      8,
      Math.min(20_000, this.context.sampleRate / 2)
    );
  }

  private noiseCutoff(baseFrequency: number, semitones: number, cents: number): number {
    if (!this.context) return 12_000;
    return clamp(
      baseFrequency * 8 * 2 ** ((semitones + cents / 100) / 12),
      80,
      Math.min(12_000, this.context.sampleRate / 2)
    );
  }

  private replaceOscillatorWithNoise(
    voice: Voice,
    part: OscillatorPart,
    semitones: number,
    cents: number,
    at: number
  ): void {
    if (!this.context || !part.oscillator) return;
    const previous = part.oscillator;
    voice.pitchLfo?.depth.disconnect(previous.detune);
    const noise = this.createNoiseSource();
    const filter = this.context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(this.noiseCutoff(part.baseFrequency, semitones, cents), at);
    noise.connect(filter);
    filter.connect(part.gain);
    noise.start(at);
    voice.sources.push(noise);
    this.trackSource(voice, noise);
    previous.stop(at);
    voice.nodes.push(filter);
    part.source = noise;
    part.oscillator = null;
    part.filter = filter;
  }

  private replaceNoiseWithOscillator(
    voice: Voice,
    part: OscillatorPart,
    settings: SynthSettings["oscillators"][number],
    at: number
  ): void {
    if (!this.context || !part.filter || settings.waveform === "noise") return;
    const oscillator = this.context.createOscillator();
    oscillator.type = settings.waveform;
    oscillator.frequency.setValueAtTime(this.oscillatorFrequency(part.baseFrequency, settings.semitones), at);
    oscillator.detune.setValueAtTime(settings.cents, at);
    oscillator.connect(part.gain);
    oscillator.start(at);
    voice.sources.push(oscillator);
    this.trackSource(voice, oscillator);
    part.source.stop(at);
    part.filter.disconnect();
    voice.pitchLfo?.depth.connect(oscillator.detune);
    part.source = oscillator;
    part.oscillator = oscillator;
    part.filter = null;
  }

  private trackSource(voice: Voice, source: AudioScheduledSourceNode): void {
    voice.activeSources++;
    source.addEventListener("ended", () => {
      voice.activeSources--;
      if (voice.released && voice.activeSources === 0) this.finishVoice(voice);
    }, { once: true });
  }

  private envelopeAt(voice: Voice, at: number): number {
    const elapsed = Math.max(0, at - voice.startedAt);
    if (voice.attack > 0 && elapsed < voice.attack) return voice.peak * elapsed / voice.attack;
    const decayElapsed = elapsed - voice.attack;
    const sustainLevel = voice.peak * voice.sustain;
    if (voice.decay > 0 && decayElapsed < voice.decay) {
      return voice.peak + (sustainLevel - voice.peak) * decayElapsed / voice.decay;
    }
    return sustainLevel;
  }

  private updateVoiceEnvelope(voice: Voice, now: number): void {
    if (!this.context) return;
    const gain = voice.envelope.gain;
    const next = this.settings.envelope;
    if (voice.released) {
      if (voice.releaseStartedAt === null || voice.releaseEndAt === null || now >= voice.releaseEndAt) return;
      const progress = (now - voice.releaseStartedAt) / (voice.releaseEndAt - voice.releaseStartedAt);
      const currentLevel = voice.releaseStartLevel * (1 - progress);
      voice.release = next.release;
      voice.releaseStartedAt = now;
      voice.releaseStartLevel = currentLevel;
      voice.releaseEndAt = now + Math.max(0.015, next.release);
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(currentLevel, now);
      gain.linearRampToValueAtTime(0, voice.releaseEndAt);
      return;
    }

    const currentLevel = this.envelopeAt(voice, now);
    voice.attack = next.attack;
    voice.decay = next.decay;
    voice.sustain = next.sustain;
    voice.release = next.release;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(currentLevel, now);
    const elapsed = Math.max(0, now - voice.startedAt);
    const attackEnd = voice.startedAt + voice.attack;
    const decayEnd = attackEnd + voice.decay;
    const sustainLevel = voice.peak * voice.sustain;
    if (elapsed < voice.attack) {
      gain.linearRampToValueAtTime(voice.peak, attackEnd);
      gain.linearRampToValueAtTime(sustainLevel, decayEnd);
    } else if (elapsed < voice.attack + voice.decay) {
      gain.linearRampToValueAtTime(sustainLevel, decayEnd);
    } else {
      gain.setTargetAtTime(sustainLevel, now, 0.015);
    }
  }

  private createNoiseSource(): AudioBufferSourceNode {
    if (!this.context) throw new Error("AudioContext has not started.");
    const buffer = this.context.createBuffer(1, this.context.sampleRate, this.context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i++) channel[i] = Math.random() * 2 - 1;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    return source;
  }

  private disposeVoice(voice: Voice): void {
    this.voices.delete(voice.id);
    for (const source of voice.sources) {
      try {
        source.stop();
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "InvalidStateError")) throw error;
      }
      source.disconnect();
    }
    for (const node of voice.nodes) node.disconnect();
  }

  private finishVoice(voice: Voice): void {
    if (this.voices.get(voice.id) !== voice) return;
    this.voices.delete(voice.id);
    for (const source of voice.sources) source.disconnect();
    for (const node of voice.nodes) node.disconnect();
  }
}
