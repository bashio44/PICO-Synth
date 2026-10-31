export type Waveform = "sine" | "square" | "sawtooth" | "triangle" | "noise";
export type LfoWaveform = "sine" | "triangle" | "square" | "sawtooth";
export const LFO_FREQUENCY_MIN = 0.1;
export const LFO_FREQUENCY_MAX = 30;

export interface OscillatorSettings {
  waveform: Waveform;
  volume: number;
  semitones: number;
  cents: number;
}

export interface EnvelopeSettings {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export interface LfoSettings {
  enabled: boolean;
  waveform: LfoWaveform;
  frequency: number;
  depth: number;
}

export interface SynthSettings {
  oscillators: [OscillatorSettings, OscillatorSettings];
  envelope: EnvelopeSettings;
  envelope2: EnvelopeSettings;
  envelope2Enabled: boolean;
  fmEnabled: boolean;
  fmDepth: number;
  pitchLfo: LfoSettings;
  volumeLfo: LfoSettings;
  polyphony: number;
}

export const defaultSynthSettings: SynthSettings = {
  oscillators: [
    { waveform: "sawtooth", volume: 0.5, semitones: 0, cents: 0 },
    { waveform: "sine", volume: 0.25, semitones: 0, cents: 0 }
  ],
  envelope: { attack: 0.08, decay: 0.22, sustain: 0.65, release: 0.35 },
  envelope2: { attack: 0.08, decay: 0.22, sustain: 0.65, release: 0.35 },
  envelope2Enabled: false,
  fmEnabled: false,
  fmDepth: 100,
  pitchLfo: { enabled: false, waveform: "sine", frequency: 5, depth: 35 },
  volumeLfo: { enabled: false, waveform: "sine", frequency: 4, depth: 0.25 },
  polyphony: 8
};

export function midiFrequency(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
