import type { AudioEngine } from "../audio/engine";
import type { MidiClip } from "./parser";

export class MidiPlayer {
  private timer: number | undefined;
  private startAt = 0;
  private nextNoteIndex = 0;
  private loopNumber = 0;
  private clip: MidiClip | null = null;
  private looping = false;
  private onProgress: (seconds: number) => void = () => undefined;
  private onFinish: () => void = () => undefined;
  private readonly lookAheadSeconds = 0.12;

  constructor(private readonly audio: AudioEngine) {}

  get isPlaying(): boolean {
    return this.timer !== undefined;
  }

  play(clip: MidiClip, looping: boolean, onProgress: (seconds: number) => void, onFinish: () => void): void {
    if (!this.audio.isRunning) throw new Error("先に「音の準備をする」を押してください。");
    if (!clip.notes.length || clip.duration < 0.05) throw new Error("再生できるノートがありません（曲が短すぎます）。");
    this.stop();
    this.clip = clip;
    this.looping = looping;
    this.onProgress = onProgress;
    this.onFinish = onFinish;
    this.startAt = this.audio.currentTime + 0.15;
    this.nextNoteIndex = 0;
    this.loopNumber = 0;
    this.scheduleAhead();
    this.timer = window.setInterval(() => this.scheduleAhead(), 25);
  }

  stop(): void {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
    this.clip = null;
    this.audio.releaseAll();
    this.onProgress(0);
  }

  private scheduleAhead(): void {
    const clip = this.clip;
    if (!clip) return;
    const now = this.audio.currentTime;
    const horizon = now + this.lookAheadSeconds;

    let scheduledCount = 0;
    while (scheduledCount < 1000) {
      if (this.nextNoteIndex >= clip.notes.length) {
        if (!this.looping) break;
        this.loopNumber++;
        this.nextNoteIndex = 0;
      }
      const note = clip.notes[this.nextNoteIndex];
      const at = this.startAt + this.loopNumber * clip.duration + note.start;
      if (at >= horizon) break;
      const voiceId = this.audio.noteOn(note.pitch, note.velocity, at);
      if (voiceId !== null) this.audio.noteOff(voiceId, at + note.duration);
      this.nextNoteIndex++;
      scheduledCount++;
    }

    const elapsed = Math.max(0, now - this.startAt);
    this.onProgress(clip.duration > 0 ? elapsed % clip.duration : 0);
    if (!this.looping && now >= this.startAt + clip.duration) {
      this.finish();
    }
  }

  private finish(): void {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
    this.clip = null;
    this.onProgress(0);
    this.onFinish();
  }
}
