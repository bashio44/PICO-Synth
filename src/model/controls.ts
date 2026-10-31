import { clamp } from "./config";

export type EnvelopeControl = "attack" | "decay" | "sustain" | "release";

export function normalizeEnvelopeControl(control: EnvelopeControl, value: number): number {
  if (!Number.isFinite(value)) return control === "sustain" ? 0 : 0.001;
  if (control === "sustain") return clamp(Math.round(clamp(value, 0, 100) * 100) / 10_000, 0, 1);
  return clamp(Math.round(value * 1_000) / 1_000, 0.001, 5);
}

export function formatEnvelopeControl(control: EnvelopeControl, value: number): string {
  return (control === "sustain" ? value * 100 : value).toFixed(control === "sustain" ? 2 : 3);
}

const LFO_MIN_FREQUENCY = 0.01;
const LFO_MAX_FREQUENCY = 2_000;
const LFO_SLIDER_STEPS = 10_000;
const LFO_FREQUENCY_RATIO = LFO_MAX_FREQUENCY / LFO_MIN_FREQUENCY;

export function lfoFrequencyToSlider(frequency: number): number {
  const bounded = clamp(frequency, LFO_MIN_FREQUENCY, LFO_MAX_FREQUENCY);
  return Math.round(Math.log(bounded / LFO_MIN_FREQUENCY) / Math.log(LFO_FREQUENCY_RATIO) * LFO_SLIDER_STEPS);
}

export function lfoSliderToFrequency(value: number): number {
  const position = clamp(value, 0, LFO_SLIDER_STEPS) / LFO_SLIDER_STEPS;
  return LFO_MIN_FREQUENCY * LFO_FREQUENCY_RATIO ** position;
}

export function formatLfoFrequency(frequency: number): string {
  return String(Number(frequency.toFixed(4)));
}
