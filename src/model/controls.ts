import { clamp, LFO_FREQUENCY_MAX, LFO_FREQUENCY_MIN } from "./config";

export type EnvelopeControl = "attack" | "decay" | "sustain" | "release";

export function normalizeEnvelopeControl(control: EnvelopeControl, value: number): number {
  if (!Number.isFinite(value)) return control === "sustain" ? 0 : 0.001;
  if (control === "sustain") return clamp(Math.round(clamp(value, 0, 100) * 100) / 10_000, 0, 1);
  return clamp(Math.round(value * 1_000) / 1_000, 0.001, 5);
}

export function formatEnvelopeControl(control: EnvelopeControl, value: number): string {
  return (control === "sustain" ? value * 100 : value).toFixed(control === "sustain" ? 2 : 3);
}

const LFO_SLIDER_STEPS = 10_000;
const LFO_FREQUENCY_RATIO = LFO_FREQUENCY_MAX / LFO_FREQUENCY_MIN;

export function normalizeLfoFrequency(frequency: number): number {
  if (!Number.isFinite(frequency)) return LFO_FREQUENCY_MIN;
  return clamp(Math.round(clamp(frequency, LFO_FREQUENCY_MIN, LFO_FREQUENCY_MAX) * 10) / 10, LFO_FREQUENCY_MIN, LFO_FREQUENCY_MAX);
}

export function lfoFrequencyToSlider(frequency: number): number {
  const bounded = normalizeLfoFrequency(frequency);
  return Math.round(Math.log(bounded / LFO_FREQUENCY_MIN) / Math.log(LFO_FREQUENCY_RATIO) * LFO_SLIDER_STEPS);
}

export function lfoSliderToFrequency(value: number): number {
  const position = clamp(value, 0, LFO_SLIDER_STEPS) / LFO_SLIDER_STEPS;
  return normalizeLfoFrequency(LFO_FREQUENCY_MIN * LFO_FREQUENCY_RATIO ** position);
}

export function formatLfoFrequency(frequency: number): string {
  return normalizeLfoFrequency(frequency).toFixed(1);
}
