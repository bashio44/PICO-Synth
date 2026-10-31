import { describe, expect, it } from "vitest";
import { EffectsGraphBuilder } from "./effects-graph";
import { defaultEffects, type EffectId } from "../model/effects";

class FakeAudioParam {
  value = 0;
  events: Array<{ method: string; value: number; time?: number }> = [];
  setValueAtTime(value: number): void { this.value = value; }
}

class FakeNode {
  connect(): void {}
  disconnect(): void {}
}

class FakeGain extends FakeNode {
  gain = new FakeAudioParam();
}

class FakeDelay extends FakeNode {
  delayTime = new FakeAudioParam();
}

class FakeOscillator extends FakeNode {
  type: OscillatorType = "sine";
  frequency = new FakeAudioParam();
  start(): void {}
  stop(): void {}
}

class FakeFilter extends FakeNode {
  type: BiquadFilterType = "lowpass";
  frequency = new FakeAudioParam();
  Q = new FakeAudioParam();
  gain = new FakeAudioParam();
}

class FakeCompressor extends FakeNode {
  threshold = new FakeAudioParam();
  ratio = new FakeAudioParam();
  knee = new FakeAudioParam();
  attack = new FakeAudioParam();
  release = new FakeAudioParam();
}

class FakeShaper extends FakeNode {
  curve: Float32Array | null = null;
  oversample: OverSampleType = "none";
}

class FakeBuffer {
  constructor(readonly length: number, readonly numberOfChannels: number) {}
  getChannelData(): Float32Array { return new Float32Array(this.length); }
}

class FakeConvolver extends FakeNode {
  buffer: AudioBuffer | null = null;
}

class FakeAudioContext {
  sampleRate = 48_000;
  destination = new FakeNode() as unknown as AudioDestinationNode;
  gains: FakeGain[] = [];
  delays: FakeDelay[] = [];
  oscillators: FakeOscillator[] = [];
  filters: FakeFilter[] = [];
  compressors: FakeCompressor[] = [];
  shapers: FakeShaper[] = [];
  convolvers: FakeConvolver[] = [];
  buffers: FakeBuffer[] = [];
  createGain(): GainNode {
    const node = new FakeGain();
    this.gains.push(node);
    return node as unknown as GainNode;
  }
  createDelay(): DelayNode {
    const node = new FakeDelay();
    this.delays.push(node);
    return node as unknown as DelayNode;
  }
  createOscillator(): OscillatorNode {
    const node = new FakeOscillator();
    this.oscillators.push(node);
    return node as unknown as OscillatorNode;
  }
  createBiquadFilter(): BiquadFilterNode {
    const node = new FakeFilter();
    this.filters.push(node);
    return node as unknown as BiquadFilterNode;
  }
  createDynamicsCompressor(): DynamicsCompressorNode {
    const node = new FakeCompressor();
    this.compressors.push(node);
    return node as unknown as DynamicsCompressorNode;
  }
  createWaveShaper(): WaveShaperNode {
    const node = new FakeShaper();
    this.shapers.push(node);
    return node as unknown as WaveShaperNode;
  }
  createConvolver(): ConvolverNode {
    const node = new FakeConvolver();
    this.convolvers.push(node);
    return node as unknown as ConvolverNode;
  }
  createBuffer(_channels: number, length: number): AudioBuffer {
    const buffer = new FakeBuffer(length, _channels);
    this.buffers.push(buffer);
    return buffer as unknown as AudioBuffer;
  }
}

function buildEffect(id: EffectId, update: (effects: typeof defaultEffects) => void = () => {}) {
  const context = new FakeAudioContext();
  const effects = structuredClone(defaultEffects);
  effects[id].enabled = true;
  update(effects);
  const builder = new EffectsGraphBuilder();
  builder.rebuild(
    context as unknown as AudioContext,
    context.createGain(),
    context.destination,
    effects,
    [{ from: "input", to: id }, { from: id, to: "output" }]
  );
  return { context, builder };
}

describe("effect audio parameter wiring", () => {
  it("uses distortion drive and wet/dry mix in the waveshaper", () => {
    const { context: lowDrive } = buildEffect("distortion", (effects) => { effects.distortion.drive = 5; });
    const { context: highDrive } = buildEffect("distortion", (effects) => {
      effects.distortion.drive = 90;
      effects.distortion.wet = 0.8;
      effects.distortion.tone = 3_500;
    });

    expect(lowDrive.shapers[0].curve).not.toEqual(highDrive.shapers[0].curve);
    expect(highDrive.gains.map((node) => node.gain.value)).toContain(0.8);
    expect(highDrive.gains.map((node) => node.gain.value).some((value) => Math.abs(value - 0.2) < 0.001)).toBe(true);
    expect(highDrive.filters.some((filter) => filter.type === "lowpass" && filter.frequency.value === 3_500)).toBe(true);
  });

  it("applies chorus rate, depth, and wet mix", () => {
    const { context } = buildEffect("chorus", (effects) => {
      effects.chorus.rate = 3.5;
      effects.chorus.depth = 0.02;
      effects.chorus.wet = 0.7;
    });
    expect(context.oscillators[0].frequency.value).toBe(3.5);
    expect(context.gains.map((node) => node.gain.value)).toContain(0.02);
    expect(context.gains.map((node) => node.gain.value)).toContain(0.7);
    expect(context.gains.map((node) => node.gain.value).some((value) => Math.abs(value - 0.3) < 0.001)).toBe(true);
  });

  it("applies compressor threshold, ratio, knee, attack, and release", () => {
    const { context } = buildEffect("compressor", (effects) => {
      effects.compressor.threshold = -36;
      effects.compressor.ratio = 8;
      effects.compressor.knee = 12;
      effects.compressor.attack = 0.02;
      effects.compressor.release = 0.4;
    });
    expect(context.compressors[0].threshold.value).toBe(-36);
    expect(context.compressors[0].ratio.value).toBe(8);
    expect(context.compressors[0].knee.value).toBe(12);
    expect(context.compressors[0].attack.value).toBe(0.02);
    expect(context.compressors[0].release.value).toBe(0.4);
  });

  it("applies EQ frequency, Q, gain, and wet mix", () => {
    const { context } = buildEffect("eq", (effects) => {
      effects.eq.bands[0].frequency = 4_000;
      effects.eq.bands[0].q = 2.4;
      effects.eq.bands[0].gain = 6;
      effects.eq.wet = 0.6;
    });
    expect(context.filters[0].frequency.value).toBe(4_000);
    expect(context.filters[0].Q.value).toBe(2.4);
    expect(context.filters[0].gain.value).toBe(6);
    expect(context.gains.map((node) => node.gain.value)).toContain(0.6);
    expect(context.gains.map((node) => node.gain.value)).toContain(0.4);
  });

  it("chains enabled peak, notch, and high-pass EQ bands in order", () => {
    const { context } = buildEffect("eq", (effects) => {
      effects.eq.bands = [
        { enabled: true, type: "peaking", frequency: 800, q: 1.2, gain: 5 },
        { enabled: true, type: "notch", frequency: 2_500, q: 4, gain: 0 },
        { enabled: true, type: "highpass", frequency: 120, q: 0.7, gain: 0 }
      ];
    });
    expect(context.filters.map((filter) => filter.type)).toEqual(["peaking", "notch", "highpass"]);
    expect(context.filters.map((filter) => filter.frequency.value)).toEqual([800, 2_500, 120]);
    expect(context.filters[0].gain.value).toBe(5);
  });

  it.each(["peaking", "notch", "highpass", "lowpass"] as const)("supports the EQ %s filter type", (type) => {
    const { context } = buildEffect("eq", (effects) => {
      effects.eq.bands[0].type = type;
    });
    expect(context.filters[0].type).toBe(type);
  });

  it("applies delay time, feedback, and wet mix", () => {
    const { context } = buildEffect("delay", (effects) => {
      effects.delay.time = 0.75;
      effects.delay.feedback = 0.6;
      effects.delay.wet = 0.45;
    });
    expect(context.delays[0].delayTime.value).toBe(0.75);
    expect(context.gains.map((node) => node.gain.value)).toContain(0.6);
    expect(context.gains.map((node) => node.gain.value)).toContain(0.45);
    expect(context.gains.map((node) => node.gain.value)).toContain(0.55);
  });

  it("applies reverb decay and wet mix", () => {
    const { context } = buildEffect("reverb", (effects) => {
      effects.reverb.decay = 2.5;
      effects.reverb.preDelay = 0.035;
      effects.reverb.wet = 0.35;
    });
    expect(context.buffers[0].length).toBe(120_000);
    expect(context.delays[0].delayTime.value).toBe(0.035);
    expect(context.convolvers[0].buffer).not.toBeNull();
    expect(context.gains.map((node) => node.gain.value)).toContain(0.35);
    expect(context.gains.map((node) => node.gain.value)).toContain(0.65);
  });
});
