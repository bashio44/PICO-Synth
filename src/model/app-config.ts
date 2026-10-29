import type { MidiClip, MidiNoteData } from "../midi/parser";
import { clamp, defaultSynthSettings, type LfoSettings, type LfoWaveform, type OscillatorSettings, type SynthSettings, type Waveform } from "./config";
import { defaultEffects, defaultRouting, type EffectConfiguration, type RoutingEdge, validateEffects, validateRouting } from "./effects";

export interface AppSettings {
  version: 1;
  synth: SynthSettings;
  effects: EffectConfiguration;
  routing: RoutingEdge[];
  midi: MidiClip | null;
}

export function createDefaultAppSettings(): AppSettings {
  return {
    version: 1,
    synth: structuredClone(defaultSynthSettings),
    effects: structuredClone(defaultEffects),
    routing: structuredClone(defaultRouting),
    midi: null
  };
}

export function stringifyAppSettings(settings: AppSettings): string {
  return JSON.stringify(settings, null, 2);
}

export function parseAppSettings(text: string): AppSettings {
  if (text.length > 20 * 1024 * 1024) throw new Error("設定JSONが大きすぎます（上限は20MBです）。");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("JSONの書き方を読み取れません。かっこやカンマを確認してください。");
  }
  const root = asRecord(value, "設定");
  if (root.version !== 1) throw new Error("この設定JSONのバージョンには対応していません。");

  const sourceSynth = asRecord(root.synth, "音色設定");
  const oscillatorValues = sourceSynth.oscillators;
  if (!Array.isArray(oscillatorValues) || oscillatorValues.length !== 2) {
    throw new Error("オシレーターは2つ必要です。");
  }
  const oscillators: [OscillatorSettings, OscillatorSettings] = [
    parseOscillator(oscillatorValues[0], "OSC 1"),
    parseOscillator(oscillatorValues[1], "OSC 2")
  ];
  const sourceEnvelope = asRecord(sourceSynth.envelope, "ADSR");
  const envelope = {
    attack: readNumber(sourceEnvelope.attack, "ADSR attack", 0.01, 5),
    decay: readNumber(sourceEnvelope.decay, "ADSR decay", 0.01, 5),
    sustain: readNumber(sourceEnvelope.sustain, "ADSR sustain", 0, 1),
    release: readNumber(sourceEnvelope.release, "ADSR release", 0.01, 5)
  };
  const synth: SynthSettings = {
    oscillators,
    envelope,
    pitchLfo: parseLfo(sourceSynth.pitchLfo, "ピッチLFO", true),
    volumeLfo: parseLfo(sourceSynth.volumeLfo, "音量LFO", false),
    polyphony: readInteger(sourceSynth.polyphony, "ポリフォニー", 1, 16)
  };

  const effects = parseEffects(root.effects);
  const routing = parseRouting(root.routing);
  const midi = parseMidi(root.midi);
  return { version: 1, synth, effects, routing, midi };
}

function parseOscillator(value: unknown, label: string): OscillatorSettings {
  const source = asRecord(value, label);
  const waveforms: Waveform[] = ["sine", "square", "sawtooth", "triangle", "noise"];
  if (typeof source.waveform !== "string" || !waveforms.includes(source.waveform as Waveform)) {
    throw new Error(`${label}の波形が正しくありません。`);
  }
  return {
    waveform: source.waveform as Waveform,
    volume: readNumber(source.volume, `${label} 音量`, 0, 1),
    semitones: readInteger(source.semitones, `${label} 音程`, -24, 24),
    cents: readNumber(source.cents, `${label} 微調整`, -100, 100)
  };
}

function parseLfo(value: unknown, label: string, pitch: boolean): LfoSettings {
  const source = asRecord(value, label);
  const waveforms: LfoWaveform[] = ["sine", "triangle", "square", "sawtooth"];
  if (typeof source.enabled !== "boolean") throw new Error(`${label}のオン・オフ設定が正しくありません。`);
  if (typeof source.waveform !== "string" || !waveforms.includes(source.waveform as LfoWaveform)) {
    throw new Error(`${label}の波形が正しくありません。`);
  }
  return {
    enabled: source.enabled,
    waveform: source.waveform as LfoWaveform,
    frequency: readNumber(source.frequency, `${label} 速さ`, 0.1, 2000),
    depth: readNumber(source.depth, `${label} 深さ`, 0, pitch ? 200 : 0.5)
  };
}

function parseEffects(value: unknown): EffectConfiguration {
  const source = asRecord(value, "エフェクト設定");
  const result: EffectConfiguration = {
    distortion: {
      enabled: readBoolean(asRecord(source.distortion, "ディストーション").enabled, "ディストーション"),
      wet: readNumber(asRecord(source.distortion, "ディストーション").wet, "ディストーション混ざり", 0, 1),
      drive: readNumber(asRecord(source.distortion, "ディストーション").drive, "ディストーション歪み", 0, 100)
    },
    chorus: {
      enabled: readBoolean(asRecord(source.chorus, "コーラス").enabled, "コーラス"),
      wet: readNumber(asRecord(source.chorus, "コーラス").wet, "コーラス混ざり", 0, 1),
      rate: readNumber(asRecord(source.chorus, "コーラス").rate, "コーラス速さ", 0.1, 10),
      depth: readNumber(asRecord(source.chorus, "コーラス").depth, "コーラス深さ", 0.001, 0.05)
    },
    compressor: {
      enabled: readBoolean(asRecord(source.compressor, "コンプレッサー").enabled, "コンプレッサー"),
      threshold: readNumber(asRecord(source.compressor, "コンプレッサー").threshold, "コンプレッサーしきい値", -100, 0),
      ratio: readNumber(asRecord(source.compressor, "コンプレッサー").ratio, "コンプレッサー比率", 1, 20)
    },
    eq: {
      enabled: readBoolean(asRecord(source.eq, "EQ").enabled, "EQ"),
      wet: readNumber(asRecord(source.eq, "EQ").wet, "EQ混ざり", 0, 1),
      frequency: readNumber(asRecord(source.eq, "EQ").frequency, "EQ周波数", 20, 20_000),
      q: readNumber(asRecord(source.eq, "EQ").q, "EQ幅", 0.1, 18),
      gain: readNumber(asRecord(source.eq, "EQ").gain, "EQゲイン", -24, 24)
    },
    delay: {
      enabled: readBoolean(asRecord(source.delay, "ディレイ").enabled, "ディレイ"),
      wet: readNumber(asRecord(source.delay, "ディレイ").wet, "ディレイ混ざり", 0, 1),
      time: readNumber(asRecord(source.delay, "ディレイ").time, "ディレイ間隔", 0.01, 2),
      feedback: readNumber(asRecord(source.delay, "ディレイ").feedback, "ディレイ反復", 0, 0.8)
    },
    reverb: {
      enabled: readBoolean(asRecord(source.reverb, "リバーブ").enabled, "リバーブ"),
      wet: readNumber(asRecord(source.reverb, "リバーブ").wet, "リバーブ混ざり", 0, 1),
      decay: readNumber(asRecord(source.reverb).decay, "リバーブ長さ", 0.1, 5)
    }
  };
  const error = validateEffects(result);
  if (error) throw new Error(error);
  return result;
}

function parseRouting(value: unknown): RoutingEdge[] {
  if (!Array.isArray(value)) throw new Error("配線設定が配列ではありません。");
  const edges = value.map((item, index) => {
    const edge = asRecord(item, `配線 ${index + 1}`);
    if (typeof edge.from !== "string" || typeof edge.to !== "string") throw new Error(`配線 ${index + 1}の始点または終点が正しくありません。`);
    return { from: edge.from, to: edge.to };
  });
  const error = validateRouting(edges);
  if (error) throw new Error(error);
  return edges;
}

function parseMidi(value: unknown): MidiClip | null {
  if (value === null) return null;
  const source = asRecord(value, "MIDIノート");
  if (typeof source.fileName !== "string" || source.fileName.length > 180) throw new Error("MIDIファイル名が正しくありません。");
  const duration = readNumber(source.duration, "MIDI曲の長さ", 0, 3600);
  const trackCount = readInteger(source.trackCount, "MIDIトラック数", 0, 256);
  if (!Array.isArray(source.notes) || source.notes.length > 100_000) throw new Error("MIDIノート数が正しくありません（上限100,000音）。");
  const notes: MidiNoteData[] = source.notes.map((item, index) => {
    const note = asRecord(item, `MIDIノート ${index + 1}`);
    if (typeof note.track !== "string" || note.track.length > 180) throw new Error(`MIDIノート ${index + 1}のトラック名が正しくありません。`);
    const parsed = {
      pitch: readInteger(note.pitch, `MIDIノート ${index + 1} 音程`, 0, 127),
      velocity: readInteger(note.velocity, `MIDIノート ${index + 1} 強さ`, 0, 127),
      start: readNumber(note.start, `MIDIノート ${index + 1} 開始`, 0, 3600),
      duration: readNumber(note.duration, `MIDIノート ${index + 1} 長さ`, 0, 3600),
      track: note.track
    };
    if (parsed.start + parsed.duration > duration + 0.01) throw new Error(`MIDIノート ${index + 1}が曲の長さを超えています。`);
    return parsed;
  });
  return { fileName: source.fileName, duration, trackCount, notes };
}

function asRecord(value: unknown, label = "設定"): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label}の形式が正しくありません。`);
  return value as Record<string, unknown>;
}

function readNumber(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label}は${min}〜${max}の範囲の数値にしてください。`);
  }
  return clamp(value, min, max);
}

function readInteger(value: unknown, label: string, min: number, max: number): number {
  const number = readNumber(value, label, min, max);
  if (!Number.isInteger(number)) throw new Error(`${label}は整数にしてください。`);
  return number;
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label}のオン・オフ設定が正しくありません。`);
  return value;
}
