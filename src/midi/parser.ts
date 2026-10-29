import { Midi } from "@tonejs/midi";

export interface MidiNoteData {
  pitch: number;
  velocity: number;
  start: number;
  duration: number;
  track: string;
}

export interface MidiClip {
  fileName: string;
  duration: number;
  trackCount: number;
  notes: MidiNoteData[];
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_NOTE_COUNT = 100_000;
const MAX_DURATION_SECONDS = 60 * 60;

export function parseMidiFile(data: ArrayBuffer, fileName: string): MidiClip {
  if (data.byteLength < 14 || data.byteLength > MAX_FILE_BYTES) {
    throw new Error("MIDIファイルは14バイト以上、10MB以下のものを選んでください。");
  }
  const header = new DataView(data);
  if (header.getUint32(0, false) !== 0x4d546864 || header.getUint32(4, false) < 6) {
    throw new Error("標準MIDIファイルのヘッダーが見つかりません。");
  }
  const format = header.getUint16(8, false);
  if (format !== 0 && format !== 1) {
    throw new Error("MIDI形式0または1のファイルを選んでください。形式2は個別の曲を同時に再生できないため未対応です。");
  }
  if ((header.getUint16(12, false) & 0x8000) !== 0) {
    throw new Error("SMPTE時間形式のMIDIは未対応です。PPQ（拍）形式のファイルを選んでください。");
  }

  let midi: Midi;
  try {
    midi = new Midi(data);
  } catch {
    throw new Error("このファイルをMIDIとして読み込めません。標準MIDIファイルを選んでください。");
  }

  const notes: MidiNoteData[] = midi.tracks.flatMap((track) =>
    track.notes.map((note) => ({
      pitch: note.midi,
      velocity: Math.round(note.velocity * 127),
      start: note.time,
      duration: note.duration,
      track: track.name || `トラック ${midi.tracks.indexOf(track) + 1}`
    }))
  ).sort((a, b) => a.start - b.start);

  const duration = Math.max(midi.duration, ...notes.map((note) => note.start + note.duration), 0);
  if (notes.length > MAX_NOTE_COUNT) throw new Error("ノート数が多すぎます（上限は100,000音です）。");
  if (!Number.isFinite(duration) || duration > MAX_DURATION_SECONDS) {
    throw new Error("曲の長さが上限の1時間を超えています。");
  }
  if (notes.some((note) =>
    !Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127 ||
    !Number.isInteger(note.velocity) || note.velocity < 0 || note.velocity > 127 ||
    !Number.isFinite(note.start) || note.start < 0 ||
    !Number.isFinite(note.duration) || note.duration < 0
  )) {
    throw new Error("MIDIに範囲外のノート情報が含まれています。");
  }

  return {
    fileName: fileName.slice(0, 180),
    duration,
    trackCount: midi.tracks.length,
    notes
  };
}
