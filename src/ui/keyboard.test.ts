import { describe, expect, it } from "vitest";
import { pianoNoteForKey } from "./keyboard";

describe("computer keyboard piano input", () => {
  it.each([
    ["KeyA", 60], ["KeyW", 61], ["KeyS", 62], ["KeyE", 63], ["KeyD", 64],
    ["KeyF", 65], ["KeyT", 66], ["KeyG", 67], ["KeyY", 68], ["KeyH", 69],
    ["KeyU", 70], ["KeyJ", 71], ["KeyK", 72]
  ])("maps %s to MIDI note %i", (code, note) => {
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
