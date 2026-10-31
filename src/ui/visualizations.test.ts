import { describe, expect, it } from "vitest";
import { defaultEffects, type EffectId } from "../model/effects";
import { effectPreviewSvg, waveformPath } from "./visualizations";

describe("waveform previews", () => {
  it.each(["sine", "square", "sawtooth", "triangle", "noise"] as const)("draws %s within the viewBox", (waveform) => {
    const path = waveformPath(waveform);
    expect(path).toMatch(/^M /);
    expect(path).not.toMatch(/NaN|Infinity/);
    expect(path.split(" L ")).toHaveLength(waveform === "noise" ? 49 : 73);
  });

  it("uses a distinct shape for every oscillator waveform", () => {
    const waveforms = ["sine", "square", "sawtooth", "triangle", "noise"] as const;
    const shapes = new Set(waveforms.map((waveform) => waveformPath(waveform)));
    expect(shapes.size).toBe(5);
  });
});

describe("effect response previews", () => {
  const effectIds: EffectId[] = ["distortion", "chorus", "compressor", "eq", "delay", "reverb"];

  it.each(effectIds)("renders an accessible, finite %s graph", (id) => {
    const svg = effectPreviewSvg(id, structuredClone(defaultEffects));
    expect(svg).toContain('role="img"');
    expect(svg).toContain("effect-curve");
    expect(svg).not.toMatch(/NaN|Infinity/);
  });

  it("redraws when any displayed sound parameter changes", () => {
    const changes: Array<[EffectId, (state: typeof defaultEffects) => void]> = [
      ["distortion", (state) => { state.distortion.drive += 1; }],
      ["distortion", (state) => { state.distortion.tone -= 100; }],
      ["distortion", (state) => { state.distortion.wet -= 0.1; }],
      ["chorus", (state) => { state.chorus.rate += 0.1; }],
      ["chorus", (state) => { state.chorus.depth += 0.001; }],
      ["chorus", (state) => { state.chorus.wet += 0.1; }],
      ["compressor", (state) => { state.compressor.threshold += 1; }],
      ["compressor", (state) => { state.compressor.ratio += 0.1; }],
      ["compressor", (state) => { state.compressor.knee += 1; }],
      ["compressor", (state) => { state.compressor.attack += 0.001; }],
      ["compressor", (state) => { state.compressor.release += 0.01; }],
      ["eq", (state) => { state.eq.bands[0].frequency += 10; }],
      ["eq", (state) => { state.eq.bands[0].q += 0.1; }],
      ["eq", (state) => { state.eq.bands[0].gain += 0.5; }],
      ["eq", (state) => { state.eq.bands[1].enabled = true; }],
      ["eq", (state) => { state.eq.wet -= 0.1; }],
      ["delay", (state) => { state.delay.time += 0.01; }],
      ["delay", (state) => { state.delay.feedback += 0.01; }],
      ["delay", (state) => { state.delay.wet += 0.01; }],
      ["reverb", (state) => { state.reverb.decay += 0.1; }],
      ["reverb", (state) => { state.reverb.preDelay += 0.005; }],
      ["reverb", (state) => { state.reverb.wet += 0.1; }]
    ];
    for (const [id, mutate] of changes) {
      const original = structuredClone(defaultEffects);
      const changed = structuredClone(defaultEffects);
      mutate(changed);
      expect(effectPreviewSvg(id, changed), `${id} preview should react to its controls`).not.toBe(effectPreviewSvg(id, original));
    }
  });

  it("uses the time axis and direct/delayed mix for the delay graph", () => {
    const settings = structuredClone(defaultEffects);
    settings.delay.time = 0.75;
    settings.delay.wet = 0.4;
    const svg = effectPreviewSvg("delay", settings);
    expect(svg).toContain("0 秒");
    expect(svg).toContain("2 秒");
    expect(svg).toContain('cy="31.8"');
    expect(svg).toContain('cy="40.2"');
  });

  it("labels chorus and reverb graphs by time and amplitude", () => {
    expect(effectPreviewSvg("chorus", structuredClone(defaultEffects))).toContain("時間");
    expect(effectPreviewSvg("reverb", structuredClone(defaultEffects))).toContain("振幅");
  });

  it("draws distinct response curves and markers for each EQ filter type", () => {
    const types = ["peaking", "notch", "highpass", "lowpass"] as const;
    const responses = types.map((type) => {
      const settings = structuredClone(defaultEffects);
      settings.eq.bands[0] = { enabled: true, type, frequency: 1_000, q: 1.2, gain: 8 };
      return effectPreviewSvg("eq", settings);
    });
    expect(new Set(responses).size).toBe(types.length);
    expect(effectPreviewSvg("eq", {
      ...structuredClone(defaultEffects),
      eq: {
        ...structuredClone(defaultEffects.eq),
        bands: [
          structuredClone(defaultEffects.eq.bands[0]),
          { enabled: true, type: "lowpass", frequency: 3_000, q: 1, gain: 0 },
          { enabled: true, type: "highpass", frequency: 150, q: 0.7, gain: 0 }
        ]
      }
    }).match(/class="effect-eq-center"/g)).toHaveLength(3);
  });
});
