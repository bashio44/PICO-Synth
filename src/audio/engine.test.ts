import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioEngine } from "./engine";
import { defaultSynthSettings } from "../model/config";

class FakeAudioParam {
  value = 0;
  setValueAtTime(value: number): void { this.value = value; }
  setTargetAtTime(value: number): void { this.value = value; }
  linearRampToValueAtTime(value: number): void { this.value = value; }
  cancelScheduledValues(): void {}
}

class FakeNode {
  connect(): void {}
  disconnect(): void {}
}

class FakeGain extends FakeNode {
  gain = new FakeAudioParam();
}

class FakeOscillator extends FakeNode {
  type: OscillatorType = "sine";
  frequency = new FakeAudioParam();
  detune = new FakeAudioParam();
  start(): void {}
  stop(): void {}
  addEventListener(): void {}
}

class FakeBuffer {
  constructor(private readonly length: number) {}
  getChannelData(): Float32Array { return new Float32Array(this.length); }
}

class FakeBufferSource extends FakeNode {
  buffer: AudioBuffer | null = null;
  loop = false;
  stopCount = 0;
  start(): void {}
  stop(): void { this.stopCount++; }
  addEventListener(): void {}
}

class FakeFilter extends FakeNode {
  type: BiquadFilterType = "lowpass";
  frequency = new FakeAudioParam();
}

class FakeAudioContext {
  currentTime = 0;
  sampleRate = 48_000;
  state: AudioContextState = "running";
  destination = new FakeNode() as unknown as AudioDestinationNode;
  oscillators: FakeOscillator[] = [];
  bufferSources: FakeBufferSource[] = [];
  filters: FakeFilter[] = [];
  async resume(): Promise<void> {}
  async suspend(): Promise<void> { this.state = "suspended"; }
  createGain(): GainNode { return new FakeGain() as unknown as GainNode; }
  createOscillator(): OscillatorNode {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator as unknown as OscillatorNode;
  }
  createBufferSource(): AudioBufferSourceNode {
    const source = new FakeBufferSource();
    this.bufferSources.push(source);
    return source as unknown as AudioBufferSourceNode;
  }
  createBuffer(_channels: number, length: number): AudioBuffer { return new FakeBuffer(length) as unknown as AudioBuffer; }
  createBiquadFilter(): BiquadFilterNode {
    const filter = new FakeFilter();
    this.filters.push(filter);
    return filter as unknown as BiquadFilterNode;
  }
}

describe("AudioEngine live voice parameters", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loops noise for the full held note instead of ending after one second", async () => {
    const context = new FakeAudioContext();
    vi.stubGlobal("AudioContext", class extends FakeAudioContext {
      constructor() { super(); return context; }
    });
    const engine = new AudioEngine();
    await engine.start();

    const settings = structuredClone(defaultSynthSettings);
    settings.oscillators[0].waveform = "noise";
    engine.setSettings(settings);
    expect(engine.noteOn(60)).not.toBeNull();

    expect(context.bufferSources).toHaveLength(1);
    expect(context.bufferSources[0].loop).toBe(true);
  });

  it("applies oscillator pitch, volume, waveform, and LFO changes to held notes", async () => {
    const context = new FakeAudioContext();
    vi.stubGlobal("AudioContext", class extends FakeAudioContext {
      constructor() { super(); return context; }
    });
    vi.stubGlobal("OscillatorNode", FakeOscillator);
    const engine = new AudioEngine();
    await engine.start();
    engine.noteOn(69);
    const carrier = context.oscillators.find((oscillator) => oscillator.frequency.value === 440);
    expect(carrier).toBeDefined();

    const settings = structuredClone(defaultSynthSettings);
    settings.oscillators[0] = { waveform: "square", volume: 0.2, semitones: 12, cents: -25 };
    settings.pitchLfo.enabled = true;
    settings.pitchLfo.frequency = 7;
    settings.pitchLfo.depth = 50;
    engine.setSettings(settings);

    expect(carrier?.type).toBe("square");
    expect(carrier?.frequency.value).toBe(880);
    expect(carrier?.detune.value).toBe(-25);
    const volumeLfo = context.oscillators.find((oscillator) => oscillator.frequency.value === 4);
    expect(volumeLfo).toBeDefined();
    const pitchLfo = context.oscillators.find((oscillator) => oscillator.frequency.value === 7);
    expect(pitchLfo).toBeDefined();
  });

  it("switches a held note between noise and pitched waveforms and retunes noise color", async () => {
    const context = new FakeAudioContext();
    vi.stubGlobal("AudioContext", class extends FakeAudioContext {
      constructor() { super(); return context; }
    });
    vi.stubGlobal("OscillatorNode", FakeOscillator);
    const engine = new AudioEngine();
    await engine.start();

    const settings = structuredClone(defaultSynthSettings);
    settings.oscillators[0].waveform = "noise";
    engine.setSettings(settings);
    engine.noteOn(69);
    const noise = context.bufferSources[0];
    const filter = context.filters[0];
    const initialCutoff = filter.frequency.value;

    settings.oscillators[0].cents = 100;
    engine.setSettings(settings);
    expect(filter.frequency.value).toBeGreaterThan(initialCutoff);

    settings.oscillators[0].waveform = "triangle";
    engine.setSettings(settings);
    expect(noise.stopCount).toBe(1);
    expect(context.oscillators.some((oscillator) => oscillator.type === "triangle")).toBe(true);
  });
});
