export interface PianoKeyboardTarget {
  tagName?: string;
  isContentEditable?: boolean;
}

const pianoKeyNotes: Readonly<Record<string, number>> = {
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

export function pianoNoteForKey(
  code: string,
  repeat: boolean,
  target: PianoKeyboardTarget | null,
  hasModifier: boolean
): number | null {
  if (repeat || hasModifier || target?.isContentEditable) return null;
  const tagName = target?.tagName?.toUpperCase();
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") return null;
  return pianoKeyNotes[code] ?? null;
}
