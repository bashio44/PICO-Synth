import { describe, expect, it } from "vitest";
import { createDefaultAppSettings, parseAppSettings, stringifyAppSettings } from "./app-config";
import { defaultRouting } from "./effects";

describe("PICO settings JSON", () => {
  it("round-trips the synth, effects, routes, and MIDI note data", () => {
    const settings = createDefaultAppSettings();
    settings.synth.oscillators[0].waveform = "noise";
    settings.effects.delay.enabled = true;
    settings.routing = [...defaultRouting];
    settings.midi = {
      fileName: "little-song.mid",
      duration: 1.25,
      trackCount: 1,
      notes: [{ pitch: 60, velocity: 96, start: 0.1, duration: 0.5, track: "Lead" }]
    };

    expect(parseAppSettings(stringifyAppSettings(settings))).toEqual(settings);
  });

  it("rejects unknown schema versions and invalid numeric values", () => {
    const settings = createDefaultAppSettings();
    expect(() => parseAppSettings(JSON.stringify({ ...settings, version: 2 }))).toThrow(/バージョン/);
    settings.synth.pitchLfo.frequency = 2001;
    expect(() => parseAppSettings(JSON.stringify(settings))).toThrow(/ピッチLFO/);
  });

  it("accepts audio-rate LFO frequencies", () => {
    const settings = createDefaultAppSettings();
    settings.synth.volumeLfo.frequency = 440;
    expect(parseAppSettings(stringifyAppSettings(settings)).synth.volumeLfo.frequency).toBe(440);
  });

  it("rejects routing cycles before accepting a preset", () => {
    const settings = createDefaultAppSettings();
    settings.routing.push({ from: "reverb", to: "distortion" });
    expect(() => parseAppSettings(JSON.stringify(settings))).toThrow(/回り続ける/);
  });

  it("rejects notes that extend beyond their saved song", () => {
    const settings = createDefaultAppSettings();
    settings.midi = {
      fileName: "bad.mid",
      duration: 1,
      trackCount: 1,
      notes: [{ pitch: 60, velocity: 100, start: 0.9, duration: 0.5, track: "Lead" }]
    };
    expect(() => parseAppSettings(JSON.stringify(settings))).toThrow(/曲の長さ/);
  });
});
