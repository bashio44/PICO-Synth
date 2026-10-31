import { describe, expect, it } from "vitest";
import {
  formatEnvelopeControl,
  lfoFrequencyToSlider,
  lfoSliderToFrequency,
  formatLfoFrequency,
  normalizeLfoFrequency,
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
  it.each([0.1, 0.2, 0.5, 1, 5, 20, 29.9, 30])("round-trips %s Hz", (frequency) => {
    expect(lfoSliderToFrequency(lfoFrequencyToSlider(frequency))).toBe(frequency);
  });

  it("uses the full slider range for the supported frequency range", () => {
    expect(lfoFrequencyToSlider(0.1)).toBe(0);
    expect(lfoFrequencyToSlider(30)).toBe(10_000);
    expect(lfoFrequencyToSlider(5)).toBeGreaterThan(3_000);
    expect(lfoFrequencyToSlider(5)).toBeLessThan(8_000);
  });

  it("normalizes and displays rates to one decimal place", () => {
    expect(normalizeLfoFrequency(5.26)).toBe(5.3);
    expect(normalizeLfoFrequency(0.03)).toBe(0.1);
    expect(normalizeLfoFrequency(30.01)).toBe(30);
    expect(formatLfoFrequency(5.26)).toBe("5.3");
    expect(formatLfoFrequency(5)).toBe("5.0");
  });
});
