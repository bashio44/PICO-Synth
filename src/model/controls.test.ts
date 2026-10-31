import { describe, expect, it } from "vitest";
import {
  formatEnvelopeControl,
  lfoFrequencyToSlider,
  lfoSliderToFrequency,
  formatLfoFrequency,
  normalizeEnvelopeControl
} from "./controls";

describe("ADSR control precision", () => {
  it.each([
    ["attack", 0.1234, 0.123, "0.123"],
    ["decay", 1.2364, 1.236, "1.236"],
    ["release", 0.0015, 0.002, "0.002"],
    ["sustain", 64.567, 0.6457, "64.57"]
  ] as const)("normalizes %s to its displayed precision", (control, value, normalized, formatted) => {
    const result = normalizeEnvelopeControl(control, value);
    expect(result).toBe(normalized);
    expect(formatEnvelopeControl(control, result)).toBe(formatted);
  });

  it("keeps every envelope parameter within its supported range", () => {
    expect(normalizeEnvelopeControl("attack", -3)).toBe(0.001);
    expect(normalizeEnvelopeControl("attack", 0.003)).toBe(0.003);
    expect(normalizeEnvelopeControl("decay", 9)).toBe(5);
    expect(normalizeEnvelopeControl("sustain", 140)).toBe(1);
    expect(normalizeEnvelopeControl("sustain", -1)).toBe(0);
    expect(normalizeEnvelopeControl("release", Number.NaN)).toBe(0.001);
  });
});

describe("LFO frequency slider mapping", () => {
  it.each([0.01, 0.1, 0.5, 1, 5, 20, 440, 2_000])("round-trips %s Hz", (frequency) => {
    expect(lfoSliderToFrequency(lfoFrequencyToSlider(frequency))).toBeCloseTo(frequency, 0);
  });

  it("uses the full slider range for the supported frequency range", () => {
    expect(lfoFrequencyToSlider(0.01)).toBe(0);
    expect(lfoFrequencyToSlider(2_000)).toBe(10_000);
    expect(lfoFrequencyToSlider(5)).toBeGreaterThan(3_000);
    expect(lfoFrequencyToSlider(5)).toBeLessThan(6_000);
  });

  it("preserves intermediate frequencies for direct numeric entry", () => {
    expect(formatLfoFrequency(0.0137)).toBe("0.0137");
    expect(formatLfoFrequency(5.2374)).toBe("5.2374");
  });
});
