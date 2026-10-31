import { describe, expect, it } from "vitest";
import { createDefaultAppSettings, parseAppSettings, stringifyAppSettings } from "./app-config";
import { defaultRouting } from "./effects";

describe("PICO settings JSON", () => {
  it("round-trips the synth, effects, routes, and MIDI note data", () => {
    const settings = createDefaultAppSettings();
    settings.synth.oscillators[0].waveform = "noise";
    settings.synth.envelope2Enabled = true;
    settings.synth.envelope2.attack = 0.27;
    settings.synth.fmEnabled = true;
    settings.synth.fmDepth = 345;
    settings.effects.compressor.knee = 8;
    settings.effects.reverb.preDelay = 0.045;
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
    settings.synth.pitchLfo.frequency = 5;
    settings.synth.fmDepth = 1001;
    expect(() => parseAppSettings(JSON.stringify(settings))).toThrow(/FM変調/);
  });

  it("accepts audio-rate LFO frequencies", () => {
    const settings = createDefaultAppSettings();
    settings.synth.volumeLfo.frequency = 440;
    expect(parseAppSettings(stringifyAppSettings(settings)).synth.volumeLfo.frequency).toBe(440);
    settings.synth.pitchLfo.frequency = 0.0137;
    expect(parseAppSettings(stringifyAppSettings(settings)).synth.pitchLfo.frequency).toBe(0.0137);
  });

  it("loads earlier v1 files with shared ADSR and default values for newer effect controls", () => {
    const settings = createDefaultAppSettings();
    const legacy = JSON.parse(stringifyAppSettings(settings)) as {
      synth: Record<string, unknown>;
      effects: Record<string, Record<string, unknown>>;
    };
    delete legacy.synth.envelope2;
    delete legacy.synth.envelope2Enabled;
    delete legacy.synth.fmEnabled;
    delete legacy.synth.fmDepth;
    delete legacy.effects.distortion.tone;
    delete legacy.effects.compressor.knee;
    delete legacy.effects.compressor.attack;
    delete legacy.effects.compressor.release;
    delete legacy.effects.reverb.preDelay;

    const restored = parseAppSettings(JSON.stringify({ ...settings, ...legacy }));
    expect(restored.synth.envelope2).toEqual(settings.synth.envelope);
    expect(restored.synth.envelope2Enabled).toBe(false);
    expect(restored.synth.fmEnabled).toBe(false);
    expect(restored.effects.distortion.tone).toBe(settings.effects.distortion.tone);
    expect(restored.effects.compressor.knee).toBe(settings.effects.compressor.knee);
    expect(restored.effects.reverb.preDelay).toBe(settings.effects.reverb.preDelay);
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
