import { describe, expect, it } from "vitest";
import { pianoKeyboardNotes, pianoNoteForKey } from "./keyboard";

describe("computer keyboard piano input", () => {
  it("maps both octaves from C3 through C5 and positions ten black keys", () => {
    const keys = pianoKeyboardNotes();
    expect(keys).toHaveLength(25);
    expect(keys[0]).toMatchObject({ note: 48, label: "C 3", shortcut: "Z", black: false });
    expect(keys[12]).toMatchObject({ note: 60, label: "C 4", shortcut: "A", black: false });
    expect(keys[24]).toMatchObject({ note: 72, label: "C 5", shortcut: "K", black: false });
    expect(keys.filter((key) => key.black)).toHaveLength(10);
    expect(keys.filter((key) => key.black).every((key) => key.blackKeyPosition !== undefined)).toBe(true);
  });

  it.each([
    ["KeyA", 60], ["KeyW", 61], ["KeyS", 62], ["KeyE", 63], ["KeyD", 64],
    ["KeyF", 65], ["KeyT", 66], ["KeyG", 67], ["KeyY", 68], ["KeyH", 69],
    ["KeyU", 70], ["KeyJ", 71], ["KeyK", 72]
  ])("maps %s to MIDI note %i", (code, note) => {
    expect(pianoNoteForKey(code, false, null, false)).toBe(note);
  });

  it.each([
    ["KeyZ", 48], ["Digit1", 49], ["KeyX", 50], ["Digit2", 51], ["KeyC", 52],
    ["KeyV", 53], ["Digit4", 54], ["KeyB", 55], ["Digit5", 56], ["KeyN", 57],
    ["Digit6", 58], ["KeyM", 59]
  ])("maps lower octave key %s to MIDI note %i", (code, note) => {
    expect(pianoNoteForKey(code, false, null, false)).toBe(note);
  });

  it.each([
    ["input", "text", false],
    ["textarea", "", false],
    ["div", "", true]
  ])("does not capture piano shortcuts while editing %s", (tagName, inputType, isContentEditable) => {
    expect(pianoNoteForKey("KeyA", false, { tagName, inputType, isContentEditable }, false)).toBeNull();
  });

  it("keeps PC keys playable after changing focused controls", () => {
    expect(pianoNoteForKey("KeyA", false, { tagName: "BUTTON" }, false)).toBe(60);
    expect(pianoNoteForKey("KeyA", false, { tagName: "INPUT", inputType: "range" }, false)).toBe(60);
    expect(pianoNoteForKey("KeyA", false, { tagName: "INPUT", inputType: "number" }, false)).toBe(60);
    expect(pianoNoteForKey("KeyA", false, { tagName: "SELECT" }, false)).toBe(60);
  });

  it("ignores key-repeat, modifier shortcuts, and unrelated keys", () => {
    expect(pianoNoteForKey("KeyA", true, null, false)).toBeNull();
    expect(pianoNoteForKey("KeyA", false, null, true)).toBeNull();
    expect(pianoNoteForKey("Space", false, null, false)).toBeNull();
  });
});
