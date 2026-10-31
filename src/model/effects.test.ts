import { describe, expect, it } from "vitest";
import { defaultEffects, defaultRouting, validateEffects, validateRouting } from "./effects";

describe("audio routing validation", () => {
  it("accepts the default serial route and a parallel send route", () => {
    expect(validateRouting(defaultRouting)).toBeNull();
    expect(validateRouting([
      ...defaultRouting,
      { from: "input", to: "send" },
      { from: "send", to: "reverb" }
    ])).toBeNull();
  });

  it("rejects cycles, duplicate edges, and disconnected output", () => {
    expect(validateRouting([...defaultRouting, { from: "reverb", to: "distortion" }])).toMatch(/回り続ける/);
    expect(validateRouting([...defaultRouting, defaultRouting[0]])).toMatch(/重複/);
    expect(validateRouting(defaultRouting.slice(0, -1))).toMatch(/出口まで/);
  });

  it("keeps delay feedback in a stable range", () => {
    const effects = structuredClone(defaultEffects);
    effects.delay.feedback = 0.9;
    expect(validateEffects(effects)).toMatch(/feedback/);
  });

  it("enforces stable ranges for the added effect controls", () => {
    const effects = structuredClone(defaultEffects);
    effects.compressor.attack = 0;
    expect(validateEffects(effects)).toMatch(/attack/);
    effects.compressor.attack = defaultEffects.compressor.attack;
    effects.reverb.preDelay = 0.21;
    expect(validateEffects(effects)).toMatch(/preDelay/);
  });
});
