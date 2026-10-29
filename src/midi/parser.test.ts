import { Midi } from "@tonejs/midi";
import { describe, expect, it } from "vitest";
import { parseMidiFile } from "./parser";

function makeMidiBytes(): ArrayBuffer {
  const midi = new Midi();
  midi.header.tempos = [{ ticks: 0, bpm: 120 }, { ticks: 480, bpm: 60 }];
  midi.header.update();
  const track = midi.addTrack();
  track.name = "Lead";
  track.addNote({ midi: 64, ticks: 240, durationTicks: 120, velocity: 0.75 });
  const secondTrack = midi.addTrack();
  secondTrack.name = "Bass";
  secondTrack.addNote({ midi: 48, ticks: 480, durationTicks: 480, velocity: 0.5 });
  const bytes = midi.toArray();
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

describe("MIDI import", () => {
  it("converts every track note and velocity into portable clip data", () => {
    const clip = parseMidiFile(makeMidiBytes(), "lesson.mid");
    expect(clip.fileName).toBe("lesson.mid");
    expect(clip.trackCount).toBe(2);
    expect(clip.notes).toHaveLength(2);
    expect(clip.notes[0]).toMatchObject({ pitch: 64, velocity: 95, track: "Lead" });
    expect(clip.notes[0].start).toBeCloseTo(0.25);
    expect(clip.notes[0].duration).toBeCloseTo(0.125);
    expect(clip.notes[1]).toMatchObject({ pitch: 48, velocity: 63, track: "Bass" });
    expect(clip.notes[1].start).toBeCloseTo(0.5);
    expect(clip.notes[1].duration).toBeCloseTo(1);
    expect(clip.duration).toBeCloseTo(1.5);
  });

  it("rejects malformed or oversized MIDI data with a user-facing error", () => {
    expect(() => parseMidiFile(new ArrayBuffer(4), "bad.mid")).toThrow(/14バイト以上/);
    expect(() => parseMidiFile(new ArrayBuffer(10 * 1024 * 1024 + 1), "large.mid")).toThrow(/10MB以下/);
  });

  it("rejects sequential MIDI format 2 instead of mixing its independent songs", () => {
    const data = makeMidiBytes();
    new DataView(data).setUint16(8, 2, false);
    expect(() => parseMidiFile(data, "sequences.mid")).toThrow(/形式2/);
  });
});
