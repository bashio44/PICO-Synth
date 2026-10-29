import { clamp, defaultSynthSettings, midiFrequency, type SynthSettings } from "../model/config";

interface Voice {
  id: number;
  note: number;
  startedAt: number;
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  envelope: GainNode;
  peak: number;
  sustain: number;
  attack: number;
  decay: number;
  release: number;
  released: boolean;
  endedSources: number;
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
    const pitchTargets: AudioParam[] = [];
    const volumeVca = this.context.createGain();
    volumeVca.gain.value = this.settings.volumeLfo.enabled ? 1 - this.settings.volumeLfo.depth : 1;
    envelope.connect(volumeVca);
    volumeVca.connect(this.master);
    nodes.push(volumeVca);
    const baseFrequency = midiFrequency(note);
    for (const oscillator of this.settings.oscillators) {
      if (oscillator.volume <= 0) continue;
      const oscillatorGain = this.context.createGain();
      oscillatorGain.gain.value = oscillator.volume;
      oscillatorGain.connect(envelope);
      nodes.push(oscillatorGain);

      const frequency = clamp(
        baseFrequency * 2 ** (oscillator.semitones / 12),
        8,
        Math.min(20_000, this.context.sampleRate / 2)
      );
      if (oscillator.waveform === "noise") {
        const noise = this.createNoiseSource();
        const filter = this.context.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = Math.min(12_000, this.context.sampleRate / 2);
        noise.connect(filter);
        filter.connect(oscillatorGain);
        nodes.push(filter);
        noise.start(now);
        sources.push(noise);
      } else {
        const source = this.context.createOscillator();
        source.type = oscillator.waveform;
        source.frequency.setValueAtTime(frequency, now);
        source.detune.setValueAtTime(oscillator.cents, now);
        source.connect(oscillatorGain);
        source.start(now);
        sources.push(source);
        pitchTargets.push(source.detune);
      }
    }

    this.addLfo(nodes, sources, pitchTargets, volumeVca, now);
    const voice: Voice = {
      id, note, startedAt: now, sources, nodes, envelope, peak, sustain,
      attack, decay, release: this.settings.envelope.release, released: false, endedSources: 0
    };
    for (const source of sources) {
      source.addEventListener("ended", () => {
        voice.endedSources++;
        if (voice.endedSources === voice.sources.length) this.finishVoice(voice);
      }, { once: true });
    }
    this.voices.set(id, voice);
    return id;
  }

  noteOff(id: number, at?: number): void {
    const voice = this.voices.get(id);
    if (!voice || voice.released || !this.context) return;
    voice.released = true;
    const now = Math.max(this.context.currentTime, at ?? this.context.currentTime);
    const currentLevel = this.envelopeAt(voice, now);
    const releaseEnd = now + Math.max(0.015, voice.release);
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

  private addLfo(nodes: AudioNode[], sources: AudioScheduledSourceNode[], pitchTargets: AudioParam[], volumeVca: GainNode, now: number): void {
    if (!this.context) return;
    const { pitchLfo, volumeLfo } = this.settings;
    if (pitchLfo.enabled && pitchTargets.length) {
      const lfo = this.context.createOscillator();
      const depth = this.context.createGain();
      lfo.type = pitchLfo.waveform;
      lfo.frequency.setValueAtTime(pitchLfo.frequency, now);
      depth.gain.setValueAtTime(pitchLfo.depth, now);
      lfo.connect(depth);
      for (const target of pitchTargets) depth.connect(target);
      lfo.start(now);
      sources.push(lfo);
      nodes.push(depth);
    }
    if (volumeLfo.enabled) {
      const lfo = this.context.createOscillator();
      const depth = this.context.createGain();
      lfo.type = volumeLfo.waveform;
      lfo.frequency.setValueAtTime(volumeLfo.frequency, now);
      depth.gain.setValueAtTime(volumeLfo.depth, now);
      lfo.connect(depth);
      depth.connect(volumeVca.gain);
      lfo.start(now);
      sources.push(lfo);
      nodes.push(depth);
    }
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
