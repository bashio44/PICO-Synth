export interface PianoKeyboardTarget {
  tagName?: string;
  inputType?: string;
  isContentEditable?: boolean;
}

export interface PianoKey {
  note: number;
  black: boolean;
  label: string;
  shortcut?: string;
  whiteIndex?: number;
  blackKeyPosition?: number;
}

const pianoKeyNotes: Readonly<Record<string, number>> = {
  KeyZ: 48,
  Digit1: 49,
  KeyX: 50,
  Digit2: 51,
  KeyC: 52,
  KeyV: 53,
  Digit4: 54,
  KeyB: 55,
  Digit5: 56,
  KeyN: 57,
  Digit6: 58,
  KeyM: 59,
  KeyA: 60,
  KeyW: 61,
  KeyS: 62,
  KeyE: 63,
  KeyD: 64,
  KeyF: 65,
  KeyT: 66,
  KeyG: 67,
  KeyY: 68,
  KeyH: 69,
  KeyU: 70,
  KeyJ: 71,
  KeyK: 72
};

const noteNames = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const blackNotes = new Set([1, 3, 6, 8, 10]);
const blackKeyOffsets = [0.67, 1.67, 3.67, 4.67, 5.67];

export function pianoKeyboardNotes(): PianoKey[] {
  let whiteIndex = 0;
  return Array.from({ length: 25 }, (_, index) => {
    const note = 48 + index;
    const semitone = index % 12;
    const black = blackNotes.has(semitone);
    const whitePosition = whiteIndex;
    if (!black) whiteIndex++;
    const label = noteNames[semitone];
    const octave = Math.floor(note / 12) - 1;
    return {
      note,
      black,
      label: `${label} ${octave}`,
      shortcut: index < 12
        ? (["Z", "1", "X", "2", "C", "V", "4", "B", "5", "N", "6", "M"][semitone])
        : index < 24
          ? ["A", "W", "S", "E", "D", "F", "T", "G", "Y", "H", "U", "J"][semitone]
          : "K",
      ...(black ? { blackKeyPosition: ((Math.floor(index / 12) * 7 + blackKeyOffsets[[1, 3, 6, 8, 10].indexOf(semitone)]) / 15) * 100 } : {}),
      ...(black ? {} : { whiteIndex: whitePosition })
    };
  });
}

export function pianoNoteForKey(
  code: string,
  repeat: boolean,
  target: PianoKeyboardTarget | null,
  hasModifier: boolean
): number | null {
  if (repeat || hasModifier || target?.isContentEditable) return null;
  const tagName = target?.tagName?.toUpperCase();
  if (tagName === "TEXTAREA") return null;
  if (tagName === "INPUT" && !["range", "number", "checkbox", "radio"].includes(target?.inputType ?? "")) return null;
  return pianoKeyNotes[code] ?? null;
}
