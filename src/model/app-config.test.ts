import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createDefaultAppSettings, parseAppSettings, stringifyAppSettings } from "./app-config";
import { defaultRouting } from "./effects";
import { parseMidiFile } from "../midi/parser";
import { midiSamples, samplePresets } from "./presets";

describe("PICO settings JSON", () => {
  it("round-trips the synth, effects, routes, and MIDI note data", () => {
    const settings = createDefaultAppSettings();
    settings.synth.oscillators[0].waveform = "noise";
    settings.synth.envelope2Enabled = true;
    settings.synth.envelope2.attack = 0.27;
    settings.synth.fmEnabled = true;
    settings.synth.fmDepth = 345;
    settings.effects.eq.bands = [
      { enabled: true, type: "highpass", frequency: 120, q: 0.7, gain: 0 },
      { enabled: true, type: "peaking", frequency: 1400, q: 1.2, gain: 4.5 },
      { enabled: false, type: "notch", frequency: 9000, q: 4, gain: 0 }
    ];
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

  it("limits LFO frequencies to 0.1–30 Hz and normalizes to tenths", () => {
    const settings = createDefaultAppSettings();
    settings.synth.volumeLfo.frequency = 30;
    settings.synth.pitchLfo.frequency = 0.1;
    expect(parseAppSettings(stringifyAppSettings(settings)).synth.volumeLfo.frequency).toBe(30);
    expect(parseAppSettings(stringifyAppSettings(settings)).synth.pitchLfo.frequency).toBe(0.1);
    settings.synth.pitchLfo.frequency = 5.26;
    expect(parseAppSettings(stringifyAppSettings(settings)).synth.pitchLfo.frequency).toBe(5.3);
    settings.synth.pitchLfo.frequency = 0.09;
    expect(() => parseAppSettings(stringifyAppSettings(settings))).toThrow(/ピッチLFO/);
    settings.synth.pitchLfo.frequency = 30.1;
    expect(() => parseAppSettings(stringifyAppSettings(settings))).toThrow(/ピッチLFO/);
  });

  it("supports fine ADSR times and wider oscillator tuning", () => {
    const settings = createDefaultAppSettings();
    settings.synth.envelope.attack = 0.001;
    settings.synth.oscillators[0].semitones = 36;
    const restored = parseAppSettings(stringifyAppSettings(settings)).synth;
    expect(restored.envelope.attack).toBe(0.001);
    expect(restored.oscillators[0].semitones).toBe(36);
    settings.synth.oscillators[0].semitones = 49;
    expect(() => parseAppSettings(stringifyAppSettings(settings))).toThrow(/音程/);
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
    delete legacy.effects.eq.bands;
    legacy.effects.eq.frequency = 2_500;
    legacy.effects.eq.q = 2;
    legacy.effects.eq.gain = 3;

    const restored = parseAppSettings(JSON.stringify({ ...settings, ...legacy }));
    expect(restored.synth.envelope2).toEqual(settings.synth.envelope);
    expect(restored.synth.envelope2Enabled).toBe(false);
    expect(restored.synth.fmEnabled).toBe(false);
    expect(restored.effects.distortion.tone).toBe(settings.effects.distortion.tone);
    expect(restored.effects.compressor.knee).toBe(settings.effects.compressor.knee);
    expect(restored.effects.reverb.preDelay).toBe(settings.effects.reverb.preDelay);
    expect(restored.effects.eq.bands[0]).toMatchObject({
      enabled: true,
      type: "peaking",
      frequency: 2_500,
      q: 2,
      gain: 3
    });
    expect(restored.effects.eq.bands.slice(1).every((band) => !band.enabled)).toBe(true);
  });

  it("validates all three EQ filter bands", () => {
    const settings = createDefaultAppSettings();
    settings.effects.eq.bands[0].type = "notch";
    settings.effects.eq.bands[1].type = "highpass";
    settings.effects.eq.bands[2].type = "lowpass";
    expect(parseAppSettings(stringifyAppSettings(settings)).effects.eq.bands.map((band) => band.type))
      .toEqual(["notch", "highpass", "lowpass"]);

    const invalid = createDefaultAppSettings();
    invalid.effects.eq.bands[0].frequency = 20_001;
    expect(() => parseAppSettings(stringifyAppSettings(invalid))).toThrow(/EQバンド1/);
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

  it("lists thirty unique sound presets and five unique MIDI performances", () => {
    const presetIds = samplePresets.map(([id]) => id);
    expect(presetIds).toHaveLength(30);
    expect(new Set(presetIds).size).toBe(presetIds.length);
    expect(presetIds[0]).toBe("sine");
    const midiIds = midiSamples.map(([id]) => id);
    expect(midiIds).toHaveLength(5);
    expect(new Set(midiIds).size).toBe(midiIds.length);
  });

  it("parses every bundled sound preset", async () => {
    await Promise.all(samplePresets.map(async ([id]) => {
      const file = await readFile(new URL(`../../public/presets/${id}.json`, import.meta.url), "utf8");
      const parsed = parseAppSettings(file);
      expect(parsed.synth.oscillators).toHaveLength(2);
    }));
  });

  it("parses all five bundled MIDI samples into playable notes", async () => {
    await Promise.all(midiSamples.map(async ([id]) => {
      const file = await readFile(new URL(`../../public/midi/${id}.mid`, import.meta.url));
      const data = new Uint8Array(file).buffer;
      const clip = parseMidiFile(data, `${id}.mid`);
      expect(clip.notes.length).toBeGreaterThan(0);
      expect(clip.duration).toBeGreaterThan(0);
    }));
  });
});
