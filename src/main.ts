import "./style.css";
import { AudioEngine } from "./audio/engine";
import { clamp, defaultSynthSettings, LFO_FREQUENCY_MAX, LFO_FREQUENCY_MIN, type SynthSettings, type Waveform } from "./model/config";
import { MidiPlayer } from "./midi/player";
import { parseMidiFile, type MidiClip } from "./midi/parser";
import {
  defaultEffects,
  defaultRouting,
  eqFilterNames,
  eqFilterTypes,
  effectTerms,
  effectNames,
  routingNodes,
  validateRouting,
  type EffectConfiguration,
  type EffectId,
  type RoutingEdge
} from "./model/effects";
import { EffectsGraphBuilder } from "./audio/effects-graph";
import { parseAppSettings, stringifyAppSettings } from "./model/app-config";
import {
  formatEnvelopeControl,
  formatLfoFrequency,
  lfoFrequencyToSlider,
  lfoSliderToFrequency,
  normalizeLfoFrequency,
  normalizeEnvelopeControl,
  type EnvelopeControl
} from "./model/controls";
import { pianoKeyboardNotes, pianoNoteForKey } from "./ui/keyboard";
import { effectPreviewSvg, waveformPath } from "./ui/visualizations";
import { midiSamples, samplePresets } from "./model/presets";

const engine = new AudioEngine();
const midiPlayer = new MidiPlayer(engine);
const effectsGraph = new EffectsGraphBuilder();
const effectSettings: EffectConfiguration = structuredClone(defaultEffects);
let routing: RoutingEdge[] = structuredClone(defaultRouting);
let loadedMidi: MidiClip | null = null;
const settings: SynthSettings = structuredClone(defaultSynthSettings);
const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("アプリの表示領域が見つかりません。");

const waveformNames: Record<Waveform, string> = {
  sine: "サイン（やさしい / Sine）",
  square: "矩形（ゲーム風 / Square）",
  sawtooth: "ノコギリ（明るい / Sawtooth）",
  triangle: "三角（やわらかい / Triangle）",
  noise: "ノイズ（ざらざら / Noise）"
};
const waveformValues: Waveform[] = ["sine", "square", "sawtooth", "triangle", "noise"];
const presetOptions = samplePresets.map(([id, english, japanese]) =>
  `<option value="${id}">${japanese} / ${english}</option>`
).join("");
const proPresetOptions = samplePresets.map(([id, english]) =>
  `<option value="${id}">${english}</option>`
).join("");
const midiSampleOptions = midiSamples.map(([id, english, japanese]) =>
  `<option value="${id}">${japanese} / ${english}</option>`
).join("");
const proMidiSampleOptions = midiSamples.map(([id, english]) =>
  `<option value="${id}">${english}</option>`
).join("");
const proEffectControls: Record<EffectId, Array<[string, string, number, number, number, string]>> = {
  distortion: [["drive", "DRIVE", 0, 100, 1, "%"], ["tone", "TONE", 200, 20000, 100, " Hz"], ["wet", "MIX", 0, 1, 0.01, "%"]],
  chorus: [["rate", "RATE", 0.1, 10, 0.1, " Hz"], ["depth", "DEPTH", 0.001, 0.05, 0.001, " s"], ["wet", "MIX", 0, 1, 0.01, "%"]],
  compressor: [["threshold", "THRESH", -100, 0, 1, " dB"], ["ratio", "RATIO", 1, 20, 0.1, ":1"], ["knee", "KNEE", 0, 40, 1, " dB"], ["attack", "ATTACK", 0.001, 1, 0.001, " s"], ["release", "RELEASE", 0.01, 1, 0.01, " s"]],
  eq: [["wet", "MIX", 0, 1, 0.01, "%"]],
  delay: [["time", "TIME", 0.01, 2, 0.01, " s"], ["feedback", "FEEDBACK", 0, 0.8, 0.01, ""], ["wet", "MIX", 0, 1, 0.01, "%"]],
  reverb: [["decay", "DECAY", 0.1, 5, 0.1, " s"], ["preDelay", "PRE", 0, 0.2, 0.005, " s"], ["wet", "MIX", 0, 1, 0.01, "%"]]
};

function oscillatorCard(index: number): string {
  const oscillator = settings.oscillators[index];
  return `
    <article class="control-card oscillator-card">
      <div class="control-card-title"><span class="osc-badge osc-${index + 1}">OSC ${index + 1}</span><span class="helper">${index === 0 ? "音のもと" : "音を重ねてみよう"}</span></div>
      <label class="field-label" for="wave-${index}"><span class="parameter-name">波のかたち</span><span class="parameter-term">Waveform</span></label>
      <select id="wave-${index}" data-osc="${index}" data-prop="waveform" aria-label="オシレーター${index + 1}の波形 Waveform">
        ${waveformValues.map((wave) => `<option value="${wave}" ${oscillator.waveform === wave ? "selected" : ""}>${waveformNames[wave]}</option>`).join("")}
      </select>
      <div class="waveform-visual"><span>信号の形</span><svg viewBox="0 0 200 48" aria-hidden="true"><path id="wave-visual-${index}" d="${waveformPath(oscillator.waveform)}"></path></svg></div>
      <div class="range-row"><label for="volume-${index}"><span class="parameter-name">音量</span><span class="parameter-term">Level (Volume)</span></label><input id="volume-${index}" type="range" min="0" max="1" step="0.01" value="${oscillator.volume}" data-osc="${index}" data-prop="volume" aria-label="オシレーター${index + 1}の音量 (Level, Volume)"><output>${Math.round(oscillator.volume * 100)}%</output></div>
      <div class="tune-row">
        <label for="semitone-${index}"><span class="parameter-name">音程 <span class="helper">半音</span></span><span class="parameter-term">Coarse Tune</span></label>
        <div class="tune-inputs"><button type="button" class="step-button" data-step="-1" data-target="semitone-${index}" aria-label="オシレーター${index + 1}の半音を下げる Coarse Tune">−</button><input id="semitone-${index}" type="number" min="-48" max="48" step="1" value="${oscillator.semitones}" data-osc="${index}" data-prop="semitones" aria-label="オシレーター${index + 1}の半音 Coarse Tune"><button type="button" class="step-button" data-step="1" data-target="semitone-${index}" aria-label="オシレーター${index + 1}の半音を上げる Coarse Tune">＋</button></div>
      </div>
      <div class="range-row compact"><label for="cents-${index}"><span class="parameter-name">微調整 <span class="helper">セント</span></span><span class="parameter-term">Fine Tune</span></label><input id="cents-${index}" type="range" min="-100" max="100" step="1" value="${oscillator.cents}" data-osc="${index}" data-prop="cents" aria-label="オシレーター${index + 1}の微調整 (Fine Tune)"><output>${oscillator.cents}</output></div>
    </article>`;
}

function proKnob(label: string, proxy: string, min: number, max: number, step: number, value: number, unit: string, disabled = false): string {
    const fraction = (value - min) / (max - min);
    const angle = -135 + fraction * 270;
    const display = proxy.endsWith("-freq-number")
      ? `${formatLfoFrequency(value)} Hz`
      : unit === "%"
        ? `${Math.round(value * (proxy.endsWith("-wet") || proxy.startsWith("volume-") ? 100 : 1))}%`
        : `${value}${unit}`;
    return `<label class="pro-control"><span class="pro-control-label">${label}</span><span class="pro-dial" style="--dial-angle:${angle}deg"><input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-proxy="${proxy}" aria-label="${label}" ${disabled ? "disabled" : ""}><span class="pro-dial-face"></span></span><output>${display}</output></label>`;
}

function proToggle(label: string, proxy: string, checked: boolean): string {
    return `<label class="pro-toggle"><input type="checkbox" data-proxy="${proxy}" ${checked ? "checked" : ""}><span class="pro-toggle-track"></span><span>${label}</span></label>`;
}

function proWaveSelect(index: 0 | 1): string {
    return `<label class="pro-select"><span>WAVEFORM</span><select data-proxy="wave-${index}" aria-label="Oscillator ${index + 1} waveform">${waveformValues.map((wave) => `<option value="${wave}" ${settings.oscillators[index].waveform === wave ? "selected" : ""}>${wave.toUpperCase()}</option>`).join("")}</select></label>`;
}

function proOscillatorPanel(index: 0 | 1): string {
    const oscillator = settings.oscillators[index];
    return `<article class="pro-module pro-oscillator pro-osc-${index + 1}"><div class="pro-module-heading"><span class="pro-module-index">0${index + 1}</span><div><h3>OSCILLATOR ${index + 1}</h3><p>${index === 0 ? "PRIMARY VOICE" : "LAYER / MODULATOR"}</p></div><span class="pro-led"></span></div>${proWaveSelect(index)}<div class="pro-knob-row">${proKnob(index === 1 ? "MOD LEVEL" : "LEVEL", `volume-${index}`, 0, 1, 0.01, oscillator.volume, "%")}${proKnob("COARSE", `semitone-${index}`, -48, 48, 1, oscillator.semitones, " st")}${proKnob("FINE", `cents-${index}`, -100, 100, 1, oscillator.cents, " ct")}</div>${index === 1 ? `<div class="pro-inline-switch">${proToggle("USE OSC 2 AS FM MODULATOR", "fm-enabled", settings.fmEnabled)}${proKnob("FM INDEX", "fm-depth", 0, 1000, 1, settings.fmDepth, " Hz")}</div>` : ""}</article>`;
}

function proEnvelopePanel(index: 0 | 1): string {
    const envelope = index === 0 ? settings.envelope : settings.envelope2;
    const enabled = index === 0 || settings.envelope2Enabled;
    const prefix = `envelope-${index}`;
    return `<div class="pro-envelope ${enabled ? "" : "is-disabled"}" data-pro-envelope="${index}"><div class="pro-envelope-heading"><h4>OSC ${index + 1} ENVELOPE</h4>${index === 1 ? proToggle("SEPARATE ADSR", "envelope2-enabled", settings.envelope2Enabled) : "<span>SHARED BY DEFAULT</span>"}</div><div class="pro-knob-row pro-adsr-knobs">${(["attack", "decay", "sustain", "release"] as const).map((part) => {
      const min = part === "sustain" ? 0 : 0.001;
      const max = part === "sustain" ? 100 : 5;
      const value = part === "sustain" ? envelope[part] * 100 : envelope[part];
      return proKnob(part.toUpperCase(), `${prefix}-${part}`, min, max, part === "sustain" ? 0.01 : 0.001, value, part === "sustain" ? "%" : " s");
    }).join("")}</div></div>`;
}

function proLfoPanel(key: "pitchLfo" | "volumeLfo"): string {
    const lfo = settings[key];
    const pitch = key === "pitchLfo";
    const target = pitch ? "pitch" : "amp";
    return `<article class="pro-module pro-lfo"><div class="pro-module-heading"><span class="pro-module-index">LFO</span><div><h3>${pitch ? "PITCH MOD" : "AMP MOD"}</h3><p>${pitch ? "FREQUENCY MOVEMENT" : "VOLUME MOVEMENT"}</p></div>${proToggle("ON", `${key}-enabled`, lfo.enabled)}</div><label class="pro-select"><span>SHAPE</span><select data-proxy="${key}-wave" aria-label="${pitch ? "Pitch" : "Amplitude"} LFO waveform">${(["sine", "triangle", "square", "sawtooth"] as const).map((wave) => `<option value="${wave}" ${lfo.waveform === wave ? "selected" : ""}>${wave.toUpperCase()}</option>`).join("")}</select></label><div class="pro-knob-row">${proKnob("RATE", `${key}-freq-number`, LFO_FREQUENCY_MIN, LFO_FREQUENCY_MAX, 0.1, lfo.frequency, " Hz")}${proKnob("DEPTH", `${key}-depth`, 0, pitch ? 200 : 0.5, pitch ? 1 : 0.01, lfo.depth, pitch ? " ct" : "")}</div><span class="pro-mod-target">TARGET · ${target}</span></article>`;
}

function proEffectPanel(id: EffectId, name: string, index: number): string {
    const config = effectSettings[id];
    const controls = proEffectControls[id].map(([prop, label, min, max, step, unit]) => {
      const value = effectValue(id, prop);
      return proKnob(label, `${id}-${prop}`, min, max, step, value, unit);
    }).join("");
    const eqControls = id === "eq"
      ? `<div class="pro-eq-mix">${proKnob("MIX", "eq-wet", 0, 1, 0.01, effectSettings.eq.wet, "%")}</div><div class="pro-eq-bands">${effectSettings.eq.bands.map((band, bandIndex) => `<div class="pro-eq-band"><div class="pro-eq-band-head"><strong>0${bandIndex + 1}</strong>${proToggle("ON", `eq-band-${bandIndex}-enabled`, band.enabled)}<select data-proxy="eq-band-${bandIndex}-type" aria-label="EQ band ${bandIndex + 1} filter type">${eqFilterTypes.map((type) => `<option value="${type}" ${band.type === type ? "selected" : ""}>${eqFilterNames[type].toUpperCase()}</option>`).join("")}</select></div><div class="pro-knob-row pro-eq-knobs">${proKnob("FREQ", `eq-band-${bandIndex}-frequency`, 20, 20000, 10, band.frequency, " Hz")}${proKnob("Q", `eq-band-${bandIndex}-q`, 0.1, 18, 0.1, band.q, "")}${proKnob("GAIN", `eq-band-${bandIndex}-gain`, -24, 24, 0.5, band.gain, " dB", band.type !== "peaking")}</div></div>`).join("")}</div>`
      : "";
    const body = id === "eq" ? eqControls : `<div class="pro-knob-row">${controls}</div>`;
    return `<article class="pro-module pro-fx-module ${id === "eq" ? "pro-fx-eq" : ""}"><div class="pro-module-heading"><span class="pro-module-index">${String(index + 1).padStart(2, "0")}</span><div><h3>${name}</h3><p>${effectTerms[id].toUpperCase()} · INSERT</p></div>${proToggle("ON", `effect-${id}`, config.enabled)}</div>${body}</article>`;
}

function proRoutingMarkup(): string {
    const options = routingNodes.map((id) =>
      `<option value="${id}">${id === "input" ? "INPUT" : id === "output" ? "OUTPUT" : id.toUpperCase()}</option>`
    ).join("");
    return `<section class="pro-module pro-routing-module"><div class="pro-module-heading"><span class="pro-module-index">I/O</span><div><h3>SIGNAL ROUTING</h3><p>PATCH THE EFFECT CHAIN</p></div></div><div class="pro-routing-controls"><label>FROM<select id="pro-route-from">${options}</select></label><span>→</span><label>TO<select id="pro-route-to">${options}</select></label><button id="pro-route-add" type="button">PATCH</button></div><div id="pro-route-list" class="pro-route-list"></div><p id="pro-route-message" class="pro-route-message" aria-live="polite"></p></section>`;
}

function proKeyboardMarkup(): string {
    return `<div class="keyboard pro-keys" role="group" aria-label="Two octave keyboard">${pianoKeyboardNotes().map((key) =>
      `<button type="button" class="key ${key.black ? "black-key" : "white-key"}" data-note="${key.note}" aria-label="${key.label}" ${key.blackKeyPosition === undefined ? "" : `style="left:${key.blackKeyPosition}%"`}><span>${key.black ? "" : key.label.startsWith("C ") ? key.label.replace(" ", "") : key.label.split(" ")[0]}</span></button>`
    ).join("")}</div>`;
}

function proMidiControls(): string {
    return `<div class="pro-midi-controls"><label for="pro-midi-sample">MIDI SAMPLE</label><select id="pro-midi-sample">${proMidiSampleOptions}</select><button id="pro-midi-load" type="button">LOAD</button><button id="pro-midi-play" type="button" disabled>PLAY</button><button id="pro-midi-stop" type="button" disabled>STOP</button><label class="pro-toggle"><input id="pro-midi-loop" type="checkbox"><span class="pro-toggle-track"></span><span>LOOP</span></label><span id="pro-midi-status">SELECT A MIDI SAMPLE</span></div>`;
}

function envelopeEditor(index: 0 | 1): string {
  const envelope = index === 0 ? settings.envelope : settings.envelope2;
  const prefix = `envelope-${index}`;
  const disabled = index === 1 && !settings.envelope2Enabled;
  return `<article class="envelope-channel ${disabled ? "is-disabled" : ""}" data-envelope-channel="${index}">
    <h3>${index === 0 ? "OSC 1" : "OSC 2"} <span class="parameter-term">${index === 0 ? "共通エンベロープ" : "個別エンベロープ"}</span></h3>
    <div class="envelope-graph"><svg id="${prefix}-svg" viewBox="0 0 400 130" role="img" aria-label="OSC ${index + 1}の音量エンベロープ"><path class="envelope-grid" d="M24 25 H376 M24 60 H376 M24 96 H376 M110 18 V102 M200 18 V102 M290 18 V102"></path><path id="${prefix}-path" d=""></path><text class="envelope-axis" x="27" y="17">音量</text><text class="envelope-axis" x="355" y="119">時間</text>${(["attack", "sustain", "release"] as const).map((part) => `<circle id="${prefix}-handle-${part}" class="envelope-handle" data-envelope-handle="${part}" r="7" tabindex="${disabled ? -1 : 0}" role="slider" aria-disabled="${disabled}" aria-valuemin="${part === "sustain" ? 0 : 0.001}" aria-valuemax="${part === "sustain" ? 100 : 5}" aria-label="OSC ${index + 1} ${part}を調整"></circle>`).join("")}</svg><div class="envelope-stages" aria-hidden="true"><span>押す<small>Note On</small></span><span>ふくらむ<small>Attack</small></span><span>保つ<small>Sustain</small></span><span>はなす<small>Release</small></span></div></div>
    <div class="adsr-grid">${(["attack", "decay", "sustain", "release"] as const).map((part, i) => `<label class="adsr-field" for="${prefix}-${part}"><span>${["A", "D", "S", "R"][i]} <small>${["ふくらむ", "落ち着く", "保つ", "消える"][i]} <span class="parameter-term">${["Attack", "Decay", "Sustain", "Release"][i]}</span></small></span><span class="number-with-unit"><input id="${prefix}-${part}" type="number" min="${part === "sustain" ? 0 : 0.001}" max="${part === "sustain" ? 100 : 5}" step="${part === "sustain" ? 0.01 : 0.001}" value="${formatEnvelopeControl(part, envelope[part])}" data-envelope-index="${index}" data-envelope-part="${part}" aria-label="OSC ${index + 1} ${part}" ${disabled ? "disabled" : ""}><span>${part === "sustain" ? "%" : "秒"}</span></span></label>`).join("")}</div>
  </article>`;
}

app.innerHTML = `
  <main class="shell">
    <header class="topbar">
      <a class="brand" href="#" aria-label="PICO synth ホーム"><span class="brand-mark" aria-hidden="true">♫</span><span>PICO<span class="brand-light">synth</span></span></a>
      <span class="header-note"><span class="sparkle" aria-hidden="true">✦</span> はじめての音づくり</span>
    </header>
    <section class="welcome card">
      <div class="welcome-copy">
        <p class="eyebrow">YOUR LITTLE SOUND STUDIO</p>
        <h1>音をさわって、<br /><span>音をつくろう！</span></h1>
        <p class="intro">波のかたちを選んで、鍵盤をひいてみよう。<br class="desktop-break" />つまみを動かすと音がどう変わるかな？</p>
        <button class="audio-button" id="audio-toggle" type="button" aria-pressed="false"><span class="button-icon" aria-hidden="true">▶</span><span>音の準備をする</span></button>
        <p class="audio-hint" id="audio-status" aria-live="polite">音を出すにはボタンを押してね</p>
      </div>
      <div class="hero-art" aria-hidden="true"><div class="orb orb-one"></div><div class="orb orb-two"></div><div class="sound-card"><span class="sound-card-label">YOUR SOUND</span><div class="wave-bars"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><span class="sound-card-foot">♪  440 Hz</span></div><span class="float-note note-a">♪</span><span class="float-note note-b">✳</span></div>
    </section>
    <nav class="tabs" aria-label="音づくりの画面"><button class="tab active" type="button" data-tab="synth" aria-current="page"><span aria-hidden="true">🎛️</span> 音づくり</button><button class="tab" type="button" data-tab="effects"><span aria-hidden="true">✨</span> エフェクト</button><div class="mode-switch" role="group" aria-label="Editor mode"><button class="mode-button active" type="button" data-mode="studio" aria-pressed="true">はじめて</button><button class="mode-button" type="button" data-mode="pro" aria-pressed="false">PRO SYNTH</button></div></nav>
    <section id="synth-view" class="view-panel">
    <section class="workspace">
      <section class="panel card" aria-labelledby="osc-title">
        <div class="panel-heading"><div><p class="eyebrow">SHAPE YOUR SOUND</p><h2 id="osc-title">音のもとをえらぼう</h2></div><span class="step-badge">01 · 波</span></div>
        <p class="panel-copy">2つの音を重ねると、もっとゆたかな音になるよ。発音数 Polyphony は最大8音です。</p>
        <div class="oscillator-grid">${oscillatorCard(0)}${oscillatorCard(1)}</div>
        <div class="fm-controls">
          <label class="switch-label" for="fm-enabled"><input id="fm-enabled" type="checkbox" ${settings.fmEnabled ? "checked" : ""}><span class="switch"></span><span class="parameter-pair"><span>OSC 2をOSC 1のFM変調に使う</span><span class="parameter-term">Frequency Modulation · On / Off</span></span></label>
          <label class="fm-depth-control" for="fm-depth"><span class="parameter-pair"><span>FMの深さ</span><span class="parameter-term">Frequency Deviation · Hz</span></span><input id="fm-depth" type="range" min="0" max="1000" step="1" value="${settings.fmDepth}" ${settings.fmEnabled ? "" : "disabled"}><output>${settings.fmDepth} Hz</output></label>
        </div>
      </section>
      <section class="panel card" aria-labelledby="env-title">
        <div class="panel-heading"><div><p class="eyebrow">SHAPE THE VOLUME</p><h2 id="env-title">音のふくらみをつくろう</h2></div><span class="step-badge badge-mint">02 · ADSR · Envelope</span></div>
        <p class="panel-copy">通常はOSC 1の設定を両方に使います。個別設定をオンにすると、OSC 2の音のふくらみも独立して調整できます。</p>
        <label class="switch-label envelope-toggle" for="envelope2-enabled"><input id="envelope2-enabled" type="checkbox" ${settings.envelope2Enabled ? "checked" : ""}><span class="switch"></span><span class="parameter-pair"><span>OSC 2に個別のADSRを使う</span><span class="parameter-term">Separate Envelope · On / Off</span></span></label>
        <div class="envelope-editors">${envelopeEditor(0)}${envelopeEditor(1)}</div>
      </section>
      <section class="panel card" aria-labelledby="lfo-title">
        <div class="panel-heading"><div><p class="eyebrow">ADD A LITTLE MOVEMENT</p><h2 id="lfo-title">ゆらぎをつけよう</h2></div><span class="step-badge badge-pink">03 · LFO</span></div>
        <p class="panel-copy">音にゆらぎを加えるしくみ。0.1〜30Hzを0.1Hz刻みで設定できます。20Hz以上は音色が変わる音声レートのゆらぎです。</p>
        <div class="lfo-grid">
          ${(["pitchLfo", "volumeLfo"] as const).map((key) => {
            const lfo = settings[key];
            const pitch = key === "pitchLfo";
            return `<article class="control-card lfo-card"><div class="lfo-title-row"><label class="switch-label" for="${key}-enabled"><input id="${key}-enabled" type="checkbox" data-lfo="${key}" data-prop="enabled" ${lfo.enabled ? "checked" : ""}><span class="switch"></span><span class="parameter-pair"><span>${pitch ? "音程のゆらぎ" : "音量のゆらぎ"}</span><span class="parameter-term">${pitch ? "Pitch LFO · On / Off" : "Amplitude LFO (Tremolo) · On / Off"}</span></span></label><span class="lfo-icon" aria-hidden="true">${pitch ? "↕" : "〰"}</span></div><div class="lfo-wave-visual"><svg viewBox="0 0 200 48" aria-hidden="true"><path id="${key}-wave-visual" d="${waveformPath(lfo.waveform)}"></path></svg></div><label class="field-label" for="${key}-wave"><span class="parameter-name">ゆらぎの形</span><span class="parameter-term">Waveform</span></label><select id="${key}-wave" data-lfo="${key}" data-prop="waveform"><option value="sine" ${lfo.waveform === "sine" ? "selected" : ""}>なめらか / Sine</option><option value="triangle" ${lfo.waveform === "triangle" ? "selected" : ""}>三角 / Triangle</option><option value="square" ${lfo.waveform === "square" ? "selected" : ""}>カクカク / Square</option><option value="sawtooth" ${lfo.waveform === "sawtooth" ? "selected" : ""}>ノコギリ / Sawtooth</option></select><div class="range-row lfo-range-row"><label for="${key}-freq"><span class="parameter-name">速さ（Hz）</span><span class="parameter-term">Rate · 対数スケール</span></label><input id="${key}-freq" type="range" min="0" max="10000" step="1" value="${lfoFrequencyToSlider(lfo.frequency)}" data-lfo="${key}" data-prop="frequency" aria-label="ゆらぎの速さ Rate, 0.1から30ヘルツ"><output>${formatLfoFrequency(lfo.frequency)} Hz</output></div><div class="lfo-frequency-number"><label for="${key}-freq-number">数値で指定 <span class="parameter-term">Hz · 0.1〜30</span></label><input id="${key}-freq-number" type="number" min="${LFO_FREQUENCY_MIN}" max="${LFO_FREQUENCY_MAX}" step="0.1" value="${formatLfoFrequency(lfo.frequency)}" data-lfo="${key}" data-prop="frequency" aria-label="ゆらぎの速さを数値で指定 Hz"></div><div class="range-row lfo-range-row compact"><label for="${key}-depth"><span class="parameter-name">深さ</span><span class="parameter-term">Depth</span></label><input id="${key}-depth" type="range" min="0" max="${pitch ? 200 : 0.5}" step="${pitch ? 1 : 0.01}" value="${lfo.depth}" data-lfo="${key}" data-prop="depth" aria-label="ゆらぎの深さ Depth"><output>${lfo.depth}${pitch ? "¢" : ""}</output></div></article>`;
          }).join("")}
        </div>
      </section>
      <section class="panel card keyboard-panel" aria-labelledby="keyboard-title">
        <div class="panel-heading"><div><p class="eyebrow">PLAY A NOTE</p><h2 id="keyboard-title">鍵盤をひいてみよう</h2></div><span class="step-badge badge-yellow">🎹 2オクターブ</span></div>
        <p class="panel-copy">鍵盤を押している間、音が鳴るよ。下のPCキーでもひけます。</p>
        <div class="keyboard" role="group" aria-label="2オクターブのピアノ鍵盤">
          ${pianoKeyboardNotes().map((key) => `<button type="button" class="key ${key.black ? "black-key" : "white-key"}" data-note="${key.note}" aria-label="${key.label}" ${key.blackKeyPosition === undefined ? "" : `style="left:${key.blackKeyPosition}%"`}><span>${key.black ? "" : key.label.startsWith("C ") ? key.label.replace(" ", "") : key.label.split(" ")[0]}</span></button>`).join("")}
        </div>
        <div class="key-shortcuts" aria-label="パソコンの音階キー"><span>LOW C3–B3</span>${["Z", "1", "X", "2", "C", "V", "4", "B", "5", "N", "6", "M"].map((key) => `<kbd>${key}</kbd>`).join("")}<span>HIGH C4–C5</span>${["A", "W", "S", "E", "D", "F", "T", "G", "Y", "H", "U", "J", "K"].map((key) => `<kbd>${key}</kbd>`).join("")}</div>
        <p class="key-hint" id="key-hint" aria-live="polite">音の準備をしたら、鍵盤を押してね</p>
      </section>
      <section class="panel card midi-panel" aria-labelledby="midi-title">
        <div class="panel-heading"><div><p class="eyebrow">PLAY YOUR OWN MUSIC</p><h2 id="midi-title">MIDIファイルをひいてみよう</h2></div><span class="step-badge badge-blue">04 · MIDI</span></div>
        <p class="panel-copy">標準MIDIファイルを読み込んで再生できます。複数のトラックはまとめて鳴り、音の強さ Velocity も反映します。</p>
        <div class="midi-controls">
          <label for="midi-sample">MIDIサンプル</label><select id="midi-sample">${midiSampleOptions}</select><button id="midi-sample-load" class="file-button" type="button">サンプルを読み込む</button>
          <label class="file-button" for="midi-file"><span aria-hidden="true">＋</span> MIDIをえらぶ</label>
          <input id="midi-file" class="visually-hidden" type="file" accept=".mid,.midi,audio/midi,audio/x-midi" aria-label="MIDIファイルを選択">
          <label class="loop-option"><input id="midi-loop" type="checkbox"><span>くり返す <small>Loop</small></span></label>
          <button id="midi-play" class="midi-action" type="button" disabled>▶ 再生 <small>Play</small></button>
          <button id="midi-stop" class="midi-action secondary" type="button" disabled>■ 停止 <small>Stop</small></button>
        </div>
        <p class="midi-status" id="midi-status" aria-live="polite">MIDIファイルを読み込むと、ここに曲の情報が表示されます。</p>
        <label class="progress-label" for="midi-progress">曲の再生位置</label><progress id="midi-progress" max="1" value="0">0%</progress>
      </section>
    </section>
    </section>
    <section id="pro-view" class="view-panel pro-view" aria-label="Professional synthesizer editor" hidden>
      <div class="pro-console">
        <header class="pro-console-header"><div class="pro-brand"><span class="pro-brand-mark">P</span><div><strong>PICO SYNTH</strong><small>PRO SOUND DESIGNER</small></div></div><div class="pro-preset-control"><label for="pro-preset-select">PRESET</label><select id="pro-preset-select">${proPresetOptions}</select><button id="pro-preset-load" type="button">LOAD</button></div><button class="pro-power" type="button" data-pro-audio aria-pressed="false">POWER <i></i></button><button class="pro-fx-button" type="button" data-tab="effects">FX RACK <span aria-hidden="true">↗</span></button></header>
        <div class="pro-status-strip"><span><i></i> VOICE ENGINE</span><span id="pro-voice-status">POLYPHONY · ${settings.polyphony} VOICES</span><span>WEB AUDIO / STEREO</span></div>
        <div class="pro-modules">
          ${proOscillatorPanel(0)}
          ${proOscillatorPanel(1)}
          <section class="pro-module pro-envelope-module"><div class="pro-module-heading"><span class="pro-module-index">ENV</span><div><h3>AMPLITUDE ENVELOPE</h3><p>SHAPE THE VOICE OVER TIME</p></div><span class="pro-envelope-shape">A — D — S — R</span></div>${proEnvelopePanel(0)}${proEnvelopePanel(1)}</section>
          <section class="pro-lfo-bank"><div class="pro-section-heading"><div><p>MODULATION MATRIX</p><h3>Movement &amp; Expression</h3></div><span>LIVE CONTROL</span></div><div class="pro-lfo-grid">${proLfoPanel("pitchLfo")}${proLfoPanel("volumeLfo")}</div></section>
          <section class="pro-keyboard-module"><div class="pro-section-heading"><div><p>PERFORMANCE</p><h3>Play the instrument</h3></div><span>CLICK · TOUCH · LOW Z–M / HIGH A–K</span></div>${proKeyboardMarkup()}${proMidiControls()}</section>
        </div>
        <footer class="pro-console-footer"><span>PICO SYNTH PRO</span><span>ALL CONTROLS ARE LINKED TO THE STUDIO EDITOR</span><button type="button" data-mode="studio">BACK TO STUDIO</button></footer>
      </div>
    </section>
    <section id="pro-fx-view" class="view-panel pro-view" aria-label="Professional effects editor" hidden>
      <div class="pro-console pro-fx-console">
        <header class="pro-console-header"><div class="pro-brand"><span class="pro-brand-mark">FX</span><div><strong>PICO FX RACK</strong><small>PRO EFFECTS DESIGNER</small></div></div><div class="pro-preset-control"><span class="pro-fx-chain-label">LIVE SIGNAL CHAIN</span></div><button class="pro-power" type="button" data-pro-audio aria-pressed="false">POWER <i></i></button><button type="button" class="pro-fx-button pro-screen-button" data-pro-screen="synth">SYNTH</button><button type="button" class="pro-fx-button active" data-pro-screen="effects">FX RACK</button></header>
        <div class="pro-status-strip"><span><i></i> REAL-TIME EFFECTS</span><span>6 INSERT MODULES</span><span>DRAG KNOBS · CLICK BYPASS</span></div>
        <div class="pro-fx-layout"><div class="pro-fx-grid">${(["distortion", "chorus", "compressor", "eq", "delay", "reverb"] as EffectId[]).map((id, index) => proEffectPanel(id, ({ distortion: "DISTORTION", chorus: "CHORUS", compressor: "COMPRESSOR", eq: "EQUALIZER", delay: "DELAY", reverb: "REVERB" })[id], index)).join("")}</div>${proRoutingMarkup()}</div>
        <footer class="pro-console-footer"><span>PICO FX RACK</span><span>PROCESSING AND ROUTING ARE SHARED WITH THE STUDIO</span><button type="button" data-pro-screen="synth">BACK TO SYNTH</button></footer>
      </div>
    </section>
    <section id="effects-view" class="view-panel" hidden>
      <section class="panel card" aria-labelledby="effects-title">
        <div class="panel-heading"><div><p class="eyebrow">COLOR YOUR SOUND</p><h2 id="effects-title">エフェクトで音をかざろう</h2></div><span class="step-badge badge-pink">05 · EFFECTS</span></div>
        <p class="panel-copy">ひとつずつオンにして、音の変化をきいてみよう。つまみを動かすと、配線された音に反映されます。</p>
        <div id="effects-grid" class="effect-grid">${(["distortion", "chorus", "compressor", "eq", "delay", "reverb"] as EffectId[]).map(effectCard).join("")}</div>
      </section>
      <section class="panel card routing-panel" aria-labelledby="routing-title">
        <div class="panel-heading"><div><p class="eyebrow">FOLLOW THE SOUND</p><h2 id="routing-title">音の道すじをつくろう</h2></div><span class="step-badge badge-blue">ROUTING</span></div>
        <p class="panel-copy">入口から出口までの配線をつなぎかえられます。分かれ道を作ると並列、センドにつなぐと別の道にも音を送れます。</p>
        <div class="routing-diagram" id="routing-diagram" aria-live="polite"></div>
        <div class="routing-editor">
          <label for="route-from">ここから <span class="parameter-term">From</span></label><select id="route-from">${routingNodes.slice(0, -1).map((id) => `<option value="${id}">${routingLabel(id)}</option>`).join("")}</select>
          <label for="route-to">ここへ <span class="parameter-term">To</span></label><select id="route-to">${routingNodes.slice(1).map((id) => `<option value="${id}">${routingLabel(id)}</option>`).join("")}</select>
          <button type="button" id="route-add" class="file-button">＋ 配線を追加</button>
        </div>
        <p id="route-message" class="route-message" aria-live="polite"></p>
        <div class="route-list" id="route-list"></div>
      </section>
    </section>
      <section class="panel card settings-panel" aria-labelledby="settings-title">
        <div class="panel-heading"><div><p class="eyebrow">KEEP YOUR SOUND</p><h2 id="settings-title">設定をテキストで保存</h2></div><span class="step-badge badge-yellow">JSON · v1</span></div>
        <p class="panel-copy">音色・エフェクト・配線・読み込んだMIDIノートを、あとで戻せるテキストにします。</p>
        <div class="preset-actions"><label for="preset-select">サンプル音色 <span class="parameter-term">プリセットを試す</span></label><select id="preset-select">${presetOptions}</select><button type="button" class="file-button" id="preset-load">音色を読み込む</button><p class="settings-status" id="preset-status" aria-live="polite"></p></div>
        <div class="settings-actions"><button type="button" class="file-button" id="settings-export">↓ 設定を書き出す</button><button type="button" class="midi-action secondary" id="settings-import">↑ このテキストを読み込む</button></div>
        <label class="visually-hidden" for="settings-json">設定JSONテキスト</label>
        <textarea id="settings-json" spellcheck="false" aria-describedby="settings-status" placeholder="「設定を書き出す」を押すと、ここにJSONが表示されます。"></textarea>
        <p class="settings-status" id="settings-status" aria-live="polite">読み込み前に設定値と配線をチェックします。</p>
      </section>
    <footer><span>MADE FOR CURIOUS EARS</span><span>小さな音から、はじめよう <span aria-hidden="true">♡</span></span></footer>
  </main>`;

const audioToggle = document.querySelector<HTMLButtonElement>("#audio-toggle")!;
const audioStatus = document.querySelector<HTMLParagraphElement>("#audio-status")!;
const keyHint = document.querySelector<HTMLParagraphElement>("#key-hint")!;
const activeNotes = new Map<number, number>();
const activePhysicalKeys = new Map<string, number>();
const activePointerNotes = new Map<number, Set<number>>();

function routingLabel(id: string): string {
  if (id === "input") return "🎹 音の入口 (Input)";
  if (id === "output") return "🔊 音の出口 (Output)";
  if (id === "send") return "↗ センド (Send)";
  const effectId = id as EffectId;
  return `${effectNames[effectId] ?? id} (${effectTerms[effectId] ?? id})`;
}

function effectCard(id: EffectId): string {
  const config = effectSettings[id];
  const graphFlow = id === "eq" ? "周波数 → ゲイン" :
    id === "chorus" ? "時間 → 振幅" :
      id === "delay" || id === "reverb" ? "時間 → 音量" :
        "入力音量 → 出力音量";
  const controls: Record<EffectId, Array<[string, string, string, number, number, number, string]>> = {
    distortion: [["drive", "歪み", "Drive", 0, 100, 1, "%"], ["tone", "音色", "Tone · Low-pass", 200, 20000, 100, " Hz"], ["wet", "音の混ざり", "Mix (Wet/Dry)", 0, 1, 0.01, "%"]],
    chorus: [["rate", "ゆらぐ速さ", "Rate", 0.1, 10, 0.1, "Hz"], ["depth", "ゆらぐ幅", "Depth", 0.001, 0.05, 0.001, "秒"], ["wet", "音の混ざり", "Mix (Wet/Dry)", 0, 1, 0.01, "%"]],
    compressor: [["threshold", "圧縮を始める音量", "Threshold", -100, 0, 1, "dB"], ["ratio", "圧縮比", "Ratio", 1, 20, 0.1, ":1"], ["knee", "圧縮のなめらかさ", "Knee", 0, 40, 1, " dB"], ["attack", "圧縮の速さ", "Attack", 0.001, 1, 0.001, " 秒"], ["release", "圧縮の戻り", "Release", 0.01, 1, 0.01, " 秒"]],
    eq: [],
    delay: [["time", "やまびこの間隔", "Delay Time", 0.01, 2, 0.01, "秒"], ["feedback", "やまびこの回数", "Feedback", 0, 0.8, 0.01, ""], ["wet", "音の混ざり", "Mix (Wet/Dry)", 0, 1, 0.01, "%"]],
    reverb: [["decay", "ひびきの長さ", "Decay Time", 0.1, 5, 0.1, " 秒"], ["preDelay", "ひびき始めの間隔", "Pre-delay", 0, 0.2, 0.005, " 秒"], ["wet", "音の混ざり", "Mix (Wet/Dry)", 0, 1, 0.01, "%"]]
  };
  const controlMarkup = id === "eq"
    ? eqControlsMarkup()
    : controls[id].map(([prop, label, term, min, max, step, unit]) =>
      effectControlMarkup(id, prop, label, term, min, max, step, unit)
    ).join("");
  return `<article class="effect-card"><div class="effect-heading"><label class="switch-label" for="effect-${id}"><input id="effect-${id}" type="checkbox" data-effect="${id}" data-prop="enabled" ${config.enabled ? "checked" : ""}><span class="switch"></span><span class="parameter-pair"><span>${effectNames[id]}</span><span class="parameter-term">${effectTerms[id]} · On / Bypass</span></span></label><span class="effect-symbol" aria-hidden="true">${["✦", "〰", "↘", "◒", "↗", "☁"][(["distortion", "chorus", "compressor", "eq", "delay", "reverb"] as EffectId[]).indexOf(id)]}</span></div><div class="effect-visual"><span>音の変化</span><span class="effect-visual-flow">${graphFlow}</span><div id="effect-visual-${id}">${effectPreviewSvg(id, effectSettings)}</div></div><div class="effect-controls">${controlMarkup}</div></article>`;
}

function effectControlMarkup(id: EffectId, prop: string, label: string, term: string, min: number, max: number, step: number, unit: string, disabled = false): string {
  const value = effectValue(id, prop);
  const shown = unit === "%" ? `${Math.round(value * (prop === "wet" ? 100 : 1))}%` : `${value}${unit ? ` ${unit}` : ""}`;
  return `<label class="effect-control" for="${id}-${prop}"><span class="parameter-pair"><span>${label}</span><span class="parameter-term">${term}</span></span><input id="${id}-${prop}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-effect="${id}" data-prop="${prop}" aria-label="${label} ${term}" ${disabled ? "disabled" : ""}><output>${shown}</output></label>`;
}

function eqControlsMarkup(): string {
  const mix = effectControlMarkup("eq", "wet", "音の混ざり", "Mix (Wet/Dry)", 0, 1, 0.01, "%");
  const bands = effectSettings.eq.bands.map((band, index) => {
    const typeOptions = eqFilterTypes.map((type) =>
      `<option value="${type}" ${band.type === type ? "selected" : ""}>${eqFilterNames[type]}</option>`
    ).join("");
    const prefix = `band-${index}`;
    return `<section class="eq-band"><div class="eq-band-heading"><strong>BAND ${index + 1}</strong><label class="switch-label" for="eq-${prefix}-enabled"><input id="eq-${prefix}-enabled" type="checkbox" data-effect="eq" data-prop="${prefix}-enabled" ${band.enabled ? "checked" : ""}><span class="switch"></span><span>ON</span></label><select id="eq-${prefix}-type" data-effect="eq" data-prop="${prefix}-type" aria-label="EQ band ${index + 1} filter type">${typeOptions}</select></div><div class="eq-band-controls">${effectControlMarkup("eq", `${prefix}-frequency`, "Frequency", "Cutoff / Center", 20, 20000, 10, "Hz")}${effectControlMarkup("eq", `${prefix}-q`, "Q", "Resonance", 0.1, 18, 0.1, "")}${effectControlMarkup("eq", `${prefix}-gain`, "Gain", "Peak only", -24, 24, 0.5, "dB", band.type !== "peaking")}</div></section>`;
  }).join("");
  return `<div class="eq-global-control">${mix}</div><div class="eq-band-list">${bands}</div>`;
}

function effectValue(id: EffectId, prop: string): number {
  if (id === "distortion") {
    if (prop === "drive") return effectSettings.distortion.drive;
    if (prop === "tone") return effectSettings.distortion.tone;
    return effectSettings.distortion.wet;
  }
  if (id === "chorus") {
    if (prop === "rate") return effectSettings.chorus.rate;
    if (prop === "depth") return effectSettings.chorus.depth;
    return effectSettings.chorus.wet;
  }
  if (id === "compressor") {
    if (prop === "threshold") return effectSettings.compressor.threshold;
    if (prop === "ratio") return effectSettings.compressor.ratio;
    if (prop === "knee") return effectSettings.compressor.knee;
    if (prop === "attack") return effectSettings.compressor.attack;
    return effectSettings.compressor.release;
  }
  if (id === "eq") {
    if (prop === "wet") return effectSettings.eq.wet;
    const band = eqBandFromProp(prop);
    if (!band || band.field === "enabled" || band.field === "type") return 0;
    return effectSettings.eq.bands[band.index][band.field];
  }
  if (id === "delay") {
    if (prop === "time") return effectSettings.delay.time;
    if (prop === "feedback") return effectSettings.delay.feedback;
    return effectSettings.delay.wet;
  }
  if (prop === "decay") return effectSettings.reverb.decay;
  if (prop === "preDelay") return effectSettings.reverb.preDelay;
  return effectSettings.reverb.wet;
}

function eqBandFromProp(prop: string): { index: 0 | 1 | 2; field: "enabled" | "type" | "frequency" | "q" | "gain" } | null {
  const match = /^band-(0|1|2)-(enabled|type|frequency|q|gain)$/.exec(prop);
  if (!match) return null;
  return {
    index: Number(match[1]) as 0 | 1 | 2,
    field: match[2] as "enabled" | "type" | "frequency" | "q" | "gain"
  };
}

function effectControlValue(id: EffectId, prop: string): boolean | number | string {
  if (id === "eq") {
    if (prop === "enabled") return effectSettings.eq.enabled;
    const band = eqBandFromProp(prop);
    if (band) return effectSettings.eq.bands[band.index][band.field];
  } else if (prop === "enabled") {
    return effectSettings[id].enabled;
  }
  return effectValue(id, prop);
}

function isEffectId(value: string): value is EffectId {
  return Object.hasOwn(effectNames, value);
}

function updateEffectSetting(id: EffectId, prop: string, value: boolean | number | string): void {
  const isToggle = prop === "enabled";
  if (id === "distortion") {
    if (isToggle && typeof value === "boolean") effectSettings.distortion.enabled = value;
    else if (prop === "drive" && typeof value === "number") effectSettings.distortion.drive = value;
    else if (prop === "tone" && typeof value === "number") effectSettings.distortion.tone = value;
    else if (prop === "wet" && typeof value === "number") effectSettings.distortion.wet = value;
  } else if (id === "chorus") {
    if (isToggle && typeof value === "boolean") effectSettings.chorus.enabled = value;
    else if (prop === "rate" && typeof value === "number") effectSettings.chorus.rate = value;
    else if (prop === "depth" && typeof value === "number") effectSettings.chorus.depth = value;
    else if (prop === "wet" && typeof value === "number") effectSettings.chorus.wet = value;
  } else if (id === "compressor") {
    if (isToggle && typeof value === "boolean") effectSettings.compressor.enabled = value;
    else if (prop === "threshold" && typeof value === "number") effectSettings.compressor.threshold = value;
    else if (prop === "ratio" && typeof value === "number") effectSettings.compressor.ratio = value;
    else if (prop === "knee" && typeof value === "number") effectSettings.compressor.knee = value;
    else if (prop === "attack" && typeof value === "number") effectSettings.compressor.attack = value;
    else if (prop === "release" && typeof value === "number") effectSettings.compressor.release = value;
  } else if (id === "eq") {
    if (isToggle && typeof value === "boolean") effectSettings.eq.enabled = value;
    else if (prop === "wet" && typeof value === "number") effectSettings.eq.wet = value;
    else {
      const bandRef = eqBandFromProp(prop);
      if (!bandRef) return;
      const band = effectSettings.eq.bands[bandRef.index];
      if (bandRef.field === "enabled" && typeof value === "boolean") band.enabled = value;
      else if (bandRef.field === "type" && typeof value === "string") {
        const selected = eqFilterTypes.find((type) => type === value);
        if (selected) band.type = selected;
      } else if (bandRef.field !== "enabled" && bandRef.field !== "type" && typeof value === "number") {
        band[bandRef.field] = value;
      }
    }
  } else if (id === "delay") {
    if (isToggle && typeof value === "boolean") effectSettings.delay.enabled = value;
    else if (prop === "time" && typeof value === "number") effectSettings.delay.time = value;
    else if (prop === "feedback" && typeof value === "number") effectSettings.delay.feedback = value;
    else if (prop === "wet" && typeof value === "number") effectSettings.delay.wet = value;
  } else {
    if (isToggle && typeof value === "boolean") effectSettings.reverb.enabled = value;
    else if (prop === "decay" && typeof value === "number") effectSettings.reverb.decay = value;
    else if (prop === "preDelay" && typeof value === "number") effectSettings.reverb.preDelay = value;
    else if (prop === "wet" && typeof value === "number") effectSettings.reverb.wet = value;
  }
}

function updateEffectPreview(id: EffectId): void {
  const preview = document.querySelector<HTMLDivElement>(`#effect-visual-${id}`);
  if (preview) preview.innerHTML = effectPreviewSvg(id, effectSettings);
}

document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-effect]").forEach((control) => {
  const update = (rebuild: boolean) => {
    const id = control.dataset.effect;
    const prop = control.dataset.prop;
    if (!id || !isEffectId(id) || !prop) return;
    const value = control instanceof HTMLInputElement && control.type === "checkbox"
      ? control.checked
      : control instanceof HTMLSelectElement ? control.value : Number(control.value);
    updateEffectSetting(id, prop, value);
    updateEffectPreview(id);
    const bandRef = id === "eq" ? eqBandFromProp(prop) : null;
    if (bandRef?.field === "type" && typeof value === "string") {
      const gain = document.querySelector<HTMLInputElement>(`#eq-band-${bandRef.index}-gain`);
      if (gain) gain.disabled = value !== "peaking";
      syncProControls();
    }
    if (control instanceof HTMLInputElement && control.type !== "checkbox") {
      const output = control.parentElement?.querySelector("output");
      if (output && typeof value === "number") output.value = effectOutput(prop, value);
    }
    if (rebuild) rebuildEffectsGraph();
  };
  control.addEventListener("input", () => update(false));
  control.addEventListener("change", () => update(true));
});

function drawRouting(): void {
  const error = validateRouting(routing);
  const diagram = document.querySelector<HTMLDivElement>("#routing-diagram")!;
  const list = document.querySelector<HTMLDivElement>("#route-list")!;
  const message = document.querySelector<HTMLParagraphElement>("#route-message")!;
  diagram.innerHTML = routing.map((edge) =>
    `<span class="route-node ${edge.from === "send" || edge.to === "send" ? "send-node" : ""}">${routingLabel(edge.from)}</span><span class="route-arrow" aria-hidden="true">→</span><span class="route-node ${edge.to === "send" ? "send-node" : ""}">${routingLabel(edge.to)}</span>`
  ).join("");
  list.innerHTML = routing.map((edge, index) =>
    `<div class="route-row"><span>${routingLabel(edge.from)} <span aria-hidden="true">→</span> ${routingLabel(edge.to)}</span><button type="button" class="route-remove" data-route-index="${index}" aria-label="${routingLabel(edge.from)}から${routingLabel(edge.to)}への配線を削除">削除</button></div>`
  ).join("");
  message.textContent = error ?? "";
  message.classList.toggle("error", Boolean(error));
  drawProRouting();
  list.querySelectorAll<HTMLButtonElement>("[data-route-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.routeIndex);
      const next = routing.filter((_, edgeIndex) => edgeIndex !== index);
      const validation = validateRouting(next);
      if (validation) {
        message.textContent = validation;
        message.classList.add("error");
        return;
      }
      routing = next;
      drawRouting();
      rebuildEffectsGraph();
    });
  });
}

function drawProRouting(): void {
  const list = document.querySelector<HTMLDivElement>("#pro-route-list");
  if (!list) return;
  const names: Record<string, string> = {
    input: "INPUT",
    output: "OUTPUT",
    send: "SEND",
    distortion: "DISTORTION",
    chorus: "CHORUS",
    compressor: "COMPRESSOR",
    eq: "EQUALIZER",
    delay: "DELAY",
    reverb: "REVERB"
  };
  list.innerHTML = routing.map((edge, index) =>
    `<div class="pro-route-row"><span>${names[edge.from]} → ${names[edge.to]}</span><button type="button" data-pro-route-index="${index}" aria-label="Remove route ${index + 1}">×</button></div>`
  ).join("");
  list.querySelectorAll<HTMLButtonElement>("[data-pro-route-index]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelector<HTMLButtonElement>(`#route-list [data-route-index="${button.dataset.proRouteIndex}"]`)?.click();
    });
  });
  const from = document.querySelector<HTMLSelectElement>("#pro-route-from");
  const to = document.querySelector<HTMLSelectElement>("#pro-route-to");
  if (from && to) {
    from.value = document.querySelector<HTMLSelectElement>("#route-from")!.value;
    to.value = document.querySelector<HTMLSelectElement>("#route-to")!.value;
  }
}

document.querySelector<HTMLButtonElement>("#pro-route-add")!.addEventListener("click", () => {
  document.querySelector<HTMLSelectElement>("#route-from")!.value =
    document.querySelector<HTMLSelectElement>("#pro-route-from")!.value;
  document.querySelector<HTMLSelectElement>("#route-to")!.value =
    document.querySelector<HTMLSelectElement>("#pro-route-to")!.value;
  document.querySelector<HTMLButtonElement>("#route-add")!.click();
  const message = document.querySelector<HTMLParagraphElement>("#route-message")!.textContent ?? "";
  const proMessage = document.querySelector<HTMLParagraphElement>("#pro-route-message")!;
  proMessage.textContent = message ? `ROUTE ERROR · ${message}` : "ROUTE UPDATED";
});

document.querySelector<HTMLButtonElement>("#route-add")!.addEventListener("click", () => {
  const from = document.querySelector<HTMLSelectElement>("#route-from")!.value;
  const to = document.querySelector<HTMLSelectElement>("#route-to")!.value;
  const next = [...routing, { from, to }];
  const error = validateRouting(next);
  const message = document.querySelector<HTMLParagraphElement>("#route-message")!;
  if (error) {
    message.textContent = error;
    message.classList.add("error");
    return;
  }
  routing = next;
  drawRouting();
  rebuildEffectsGraph();
});
drawRouting();

function applySettings(): void {
  engine.setSettings(settings);
}

function startNote(note: number): void {
  if (activeNotes.has(note)) return;
  const voice = engine.noteOn(note);
  if (voice === null) {
    keyHint.textContent = "先に「音の準備をする」を押してね";
    return;
  }
  activeNotes.set(note, voice);
  document.querySelectorAll<HTMLButtonElement>(`.key[data-note="${note}"]`).forEach((key) => key.classList.add("pressed"));
  keyHint.textContent = `${noteName(note)} の音が鳴っています`;
}

function stopNote(note: number): void {
  const voice = activeNotes.get(note);
  if (voice === undefined) return;
  engine.noteOff(voice);
  activeNotes.delete(note);
  document.querySelectorAll<HTMLButtonElement>(`.key[data-note="${note}"]`).forEach((key) => key.classList.remove("pressed"));
}

function releaseKeyboardNotes(): void {
  const heldNotes = new Set(activePhysicalKeys.values());
  activePhysicalKeys.clear();
  for (const note of heldNotes) {
    if (!activePointerNotes.has(note)) stopNote(note);
  }
}

function stopMidiTransport(clearEffects = true): void {
  midiPlayer.stop();
  for (const note of activeNotes.keys()) stopNote(note);
  if (clearEffects && engine.isRunning) rebuildEffectsGraph();
}

function noteName(note: number): string {
  return ["ド", "ド♯", "レ", "レ♯", "ミ", "ファ", "ファ♯", "ソ", "ソ♯", "ラ", "ラ♯", "シ"][note % 12] + ` ${Math.floor(note / 12) - 1}`;
}

audioToggle.addEventListener("click", async () => {
  try {
    if (engine.isRunning) {
      stopMidiTransport(false);
      effectsGraph.dispose();
      await engine.stop();
      audioToggle.setAttribute("aria-pressed", "false");
      document.querySelectorAll<HTMLButtonElement>("[data-pro-audio]").forEach((button) => {
        button.classList.remove("is-on");
        button.setAttribute("aria-pressed", "false");
      });
      audioToggle.querySelector(".button-icon")!.textContent = "▶";
      audioToggle.querySelector("span:last-child")!.textContent = "音の準備をする";
      audioStatus.textContent = "音を止めました。またいつでも準備できます。";
      keyHint.textContent = "音の準備をしたら、鍵盤を押してね";
    } else {
      await engine.start();
      const graphReady = rebuildEffectsGraph();
      audioToggle.setAttribute("aria-pressed", "true");
      document.querySelectorAll<HTMLButtonElement>("[data-pro-audio]").forEach((button) => {
        button.classList.add("is-on");
        button.setAttribute("aria-pressed", "true");
      });
      audioToggle.querySelector(".button-icon")!.textContent = "■";
      audioToggle.querySelector("span:last-child")!.textContent = "音をとめる";
      audioStatus.textContent = graphReady ? "準備OK！鍵盤を押して音を鳴らそう" : document.querySelector<HTMLParagraphElement>("#route-message")!.textContent;
      keyHint.textContent = "鍵盤を押すか、下のPCキーで弾いてみよう";
    }
  } catch (error) {
    audioStatus.textContent = "音声を開始できませんでした。ブラウザーの設定をご確認ください。";
    console.error("Audio start/stop failed:", error);
  }
});

function rebuildEffectsGraph(): boolean {
  if (!engine.isRunning) return true;
  try {
    effectsGraph.rebuild(engine.audioContext, engine.output, engine.audioContext.destination, effectSettings, routing);
    document.querySelector<HTMLParagraphElement>("#route-message")!.textContent = "";
    document.querySelector<HTMLParagraphElement>("#route-message")!.classList.remove("error");
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "エフェクトを設定できませんでした。";
    document.querySelector<HTMLParagraphElement>("#route-message")!.textContent = message;
    document.querySelector<HTMLParagraphElement>("#route-message")!.classList.add("error");
    audioStatus.textContent = message;
    return false;
  }
}

let editorMode: "studio" | "pro" = "studio";

function updateEditorView(tab: "synth" | "effects" = "synth"): void {
  const inProMode = editorMode === "pro";
  const proSynth = inProMode && tab === "synth";
  const proEffects = inProMode && tab === "effects";
  document.querySelector<HTMLElement>("#synth-view")!.hidden = tab !== "synth" || inProMode;
  document.querySelector<HTMLElement>("#pro-view")!.hidden = !proSynth;
  document.querySelector<HTMLElement>("#pro-fx-view")!.hidden = !proEffects;
  document.querySelector<HTMLElement>("#effects-view")!.hidden = tab !== "effects" || inProMode;
  document.querySelector<HTMLElement>(".shell")!.classList.toggle("pro-mode", inProMode);
  document.querySelector<HTMLElement>(".shell")!.classList.toggle("effects-open", tab === "effects");
  document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
    const active = button.dataset.tab === tab && button.closest(".tabs");
    button.classList.toggle("active", Boolean(active));
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
    const active = button.dataset.mode === editorMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-pro-screen]").forEach((button) => {
    const active = button.dataset.proScreen === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const effectsTab = document.querySelector<HTMLButtonElement>('.tabs [data-tab="effects"]');
  if (effectsTab) effectsTab.innerHTML = inProMode ? "FX RACK" : '<span aria-hidden="true">✨</span> エフェクト';
}

document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    editorMode = button.dataset.mode === "pro" ? "pro" : "studio";
    updateEditorView();
    syncProControls();
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    updateEditorView(tab.dataset.tab === "effects" ? "effects" : "synth");
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-pro-screen]").forEach((button) => {
  button.addEventListener("click", () => updateEditorView(button.dataset.proScreen === "effects" ? "effects" : "synth"));
});
document.querySelectorAll<HTMLButtonElement>("[data-pro-audio]").forEach((button) => {
  button.addEventListener("click", () => document.querySelector<HTMLButtonElement>("#audio-toggle")!.click());
});

function isEffectEnabled(id: EffectId): boolean {
  return effectSettings[id].enabled;
}

function effectOutput(prop: string, value: number): string {
  if (prop === "wet") return `${Math.round(value * 100)}%`;
  const band = eqBandFromProp(prop);
  if (band?.field === "frequency") return `${value} Hz`;
  if (band?.field === "gain") return `${value} dB`;
  if (band?.field === "q") return String(value);
  if (["time", "decay", "preDelay", "attack", "release", "depth"].includes(prop)) return `${value} 秒`;
  if (["rate", "frequency", "tone"].includes(prop)) return `${value} Hz`;
  if (["threshold", "gain", "knee"].includes(prop)) return `${value} dB`;
  if (prop === "ratio") return `${value}:1`;
  return `${value}${prop === "feedback" ? "" : "%"}`;
}

function syncSettingsToUI(): void {
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-osc]").forEach((control) => {
    const oscillator = settings.oscillators[Number(control.dataset.osc) as 0 | 1];
    const prop = control.dataset.prop;
    const value = prop === "waveform" ? oscillator.waveform :
      prop === "volume" ? oscillator.volume :
      prop === "semitones" ? oscillator.semitones : oscillator.cents;
    control.value = String(value);
    if (prop === "waveform") {
      const path = document.querySelector<SVGPathElement>(`#wave-visual-${control.dataset.osc}`);
      if (path) path.setAttribute("d", waveformPath(oscillator.waveform));
    }
    if (prop === "volume" || prop === "cents") {
      const output = control.parentElement?.querySelector("output");
      if (output) output.value = prop === "volume" ? `${Math.round(Number(value) * 100)}%` : String(value);
    }
  });
  document.querySelectorAll<HTMLInputElement>("[data-envelope-part]").forEach((input) => {
    const index = Number(input.dataset.envelopeIndex) as 0 | 1;
    const prop = input.dataset.envelopePart as EnvelopeControl;
    const envelope = envelopeSettings(index);
    envelope[prop] = normalizeEnvelopeControl(prop, prop === "sustain" ? envelope[prop] * 100 : envelope[prop]);
    input.value = formatEnvelopeControl(prop, envelope[prop]);
  });
  document.querySelector<HTMLInputElement>("#envelope2-enabled")!.checked = settings.envelope2Enabled;
  const secondEnvelope = document.querySelector<HTMLElement>('[data-envelope-channel="1"]')!;
  secondEnvelope.classList.toggle("is-disabled", !settings.envelope2Enabled);
  secondEnvelope.querySelectorAll<HTMLInputElement>("[data-envelope-part]").forEach((input) => {
    input.disabled = !settings.envelope2Enabled;
  });
  secondEnvelope.querySelectorAll<SVGCircleElement>("[data-envelope-handle]").forEach((handle) => {
    handle.tabIndex = settings.envelope2Enabled ? 0 : -1;
    handle.setAttribute("aria-disabled", String(!settings.envelope2Enabled));
  });
  const fmEnabled = document.querySelector<HTMLInputElement>("#fm-enabled")!;
  const fmDepth = document.querySelector<HTMLInputElement>("#fm-depth")!;
  const fmOutput = fmDepth.parentElement?.querySelector("output");
  fmEnabled.checked = settings.fmEnabled;
  fmDepth.value = String(settings.fmDepth);
  fmDepth.disabled = !settings.fmEnabled;
  if (fmOutput) fmOutput.value = `${settings.fmDepth} Hz`;
  for (const index of settings.oscillators.keys()) {
    const volumeLabel = document.querySelector<HTMLLabelElement>(`label[for="volume-${index}"] .parameter-name`);
    if (volumeLabel) volumeLabel.textContent = index === 1 && settings.fmEnabled ? "変調量" : "音量";
  }
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-lfo]").forEach((control) => {
    const key = control.dataset.lfo as "pitchLfo" | "volumeLfo";
    const prop = control.dataset.prop as "enabled" | "waveform" | "frequency" | "depth";
    const lfo = settings[key];
    if (prop === "enabled" && control instanceof HTMLInputElement) control.checked = lfo.enabled;
    else control.value = String(prop === "waveform" ? lfo.waveform :
      prop === "frequency" ? control.id.endsWith("-freq-number") ? formatLfoFrequency(lfo.frequency) : lfoFrequencyToSlider(lfo.frequency) :
        lfo.depth);
    if (prop === "frequency" || prop === "depth") {
      const output = prop === "frequency"
        ? document.querySelector<HTMLInputElement>(`#${key}-freq`)?.parentElement?.querySelector("output")
        : control.parentElement?.querySelector("output");
      if (output) output.value = prop === "frequency" ? `${formatLfoFrequency(lfo.frequency)} Hz${lfo.frequency > 20 ? " · 音声レート" : ""}` : `${lfo.depth}${key === "pitchLfo" ? "¢" : ""}`;
    }
    if (prop === "waveform") {
      const path = document.querySelector<SVGPathElement>(`#${key}-wave-visual`);
      if (path) path.setAttribute("d", waveformPath(lfo.waveform));
    }
  });
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-effect]").forEach((control) => {
    const id = control.dataset.effect;
    const prop = control.dataset.prop;
    if (!id || !isEffectId(id) || !prop) return;
    const value = effectControlValue(id, prop);
    if (control instanceof HTMLInputElement && control.type === "checkbox") {
      control.checked = typeof value === "boolean" ? value : isEffectEnabled(id);
    }
    else {
      control.value = String(value);
      if (control instanceof HTMLInputElement) {
        const band = id === "eq" ? eqBandFromProp(prop) : null;
        if (band?.field === "gain") control.disabled = effectSettings.eq.bands[band.index].type !== "peaking";
        const output = control.parentElement?.querySelector("output");
        if (output && typeof value === "number") output.value = effectOutput(prop, value);
      }
    }
    updateEffectPreview(id);
  });
  drawEnvelope(0);
  drawEnvelope(1);
  drawRouting();
  syncProControls();
  syncProMidiControls();
}

function syncProControls(): void {
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(".pro-console [data-proxy]").forEach((control) => {
    const proxy = control.dataset.proxy;
    const source = proxy ? document.getElementById(proxy) : null;
    if (!(source instanceof HTMLInputElement || source instanceof HTMLSelectElement)) return;
    if (control instanceof HTMLInputElement && control.type === "checkbox" && source instanceof HTMLInputElement) {
      control.checked = source.checked;
    } else {
      control.value = source.value;
    }
    control.disabled = source.disabled;
    const envelopeDisabled = proxy?.startsWith("envelope-1-") && !settings.envelope2Enabled;
    if (envelopeDisabled) control.disabled = true;
    if (control instanceof HTMLInputElement && control.type === "range") {
      const dial = control.closest<HTMLElement>(".pro-dial");
      const min = Number(control.min);
      const max = Number(control.max);
      const fraction = (Number(control.value) - min) / (max - min);
      if (dial) dial.style.setProperty("--dial-angle", `${-135 + fraction * 270}deg`);
      const output = control.closest(".pro-control")?.querySelector("output");
      if (output) {
        const value = Number(control.value);
        const formatted = proxy?.endsWith("-freq-number")
          ? formatLfoFrequency(value)
          : proxy?.startsWith("envelope-") && !proxy.endsWith("-sustain")
            ? value.toFixed(3)
            : Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
        const effectProp = source.dataset.prop;
        const effectId = source.dataset.effect;
        output.value = effectId && effectProp && isEffectId(effectId) ? effectOutput(effectProp, value) :
          proxy?.startsWith("volume-") ? `${Math.round(value * 100)}%` :
          proxy?.startsWith("semitone-") ? `${formatted} st` :
          proxy?.startsWith("cents-") ? `${formatted} ct` :
          proxy === "fm-depth" || proxy?.endsWith("-freq-number") ? `${formatted} Hz` :
          proxy?.endsWith("-sustain") ? `${formatted}%` :
          proxy?.startsWith("envelope-") ? `${formatted} s` :
          proxy === "pitchLfo-depth" ? `${formatted} ct` : formatted;
      }
    }
  });
  document.querySelectorAll<HTMLElement>("[data-pro-envelope]").forEach((panel) => {
    panel.classList.toggle("is-disabled", panel.dataset.proEnvelope === "1" && !settings.envelope2Enabled);
  });
  const modulationLabel = document.querySelector<HTMLElement>(".pro-osc-2 .pro-control-label");
  if (modulationLabel) modulationLabel.textContent = "MOD LEVEL";
  const voiceStatus = document.querySelector<HTMLElement>("#pro-voice-status");
  if (voiceStatus) voiceStatus.textContent = `POLYPHONY · ${settings.polyphony} VOICES`;
}

document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(".pro-console [data-proxy]").forEach((control) => {
  const updateSource = (event: Event) => {
    const source = document.getElementById(control.dataset.proxy ?? "");
    if (!(source instanceof HTMLInputElement || source instanceof HTMLSelectElement)) return;
    if (control instanceof HTMLInputElement && control.type === "checkbox" && source instanceof HTMLInputElement) {
      source.checked = control.checked;
    } else {
      source.value = control.value;
    }
    source.dispatchEvent(new Event(event.type, { bubbles: true }));
  };
  control.addEventListener("input", updateSource);
  control.addEventListener("change", updateSource);
});

document.querySelectorAll<HTMLInputElement>(".pro-dial input").forEach((dial) => {
  let pointerId: number | null = null;
  const setFromPointer = (event: PointerEvent) => {
    const bounds = dial.getBoundingClientRect();
    const angle = (Math.atan2(event.clientY - bounds.top - bounds.height / 2, event.clientX - bounds.left - bounds.width / 2) * 180 / Math.PI + 360) % 360;
    const arcAngle = angle < 135 ? angle + 360 : angle;
    const fraction = clamp((arcAngle - 135) / 270, 0, 1);
    const min = Number(dial.min);
    const max = Number(dial.max);
    const step = Number(dial.step) || 1;
    const next = min + Math.round((fraction * (max - min)) / step) * step;
    dial.value = String(clamp(next, min, max));
    dial.dispatchEvent(new Event("input", { bubbles: true }));
  };
  dial.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    pointerId = event.pointerId;
    dial.setPointerCapture(event.pointerId);
    setFromPointer(event);
  });
  dial.addEventListener("pointermove", (event) => {
    if (event.pointerId === pointerId) setFromPointer(event);
  });
  dial.addEventListener("pointerup", (event) => {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    dial.dispatchEvent(new Event("change", { bubbles: true }));
  });
  dial.addEventListener("pointercancel", () => { pointerId = null; });
});

document.addEventListener("input", (event) => {
  if (event.target instanceof HTMLElement && !event.target.closest(".pro-console")) syncProControls();
});
document.addEventListener("change", (event) => {
  if (event.target instanceof HTMLElement && !event.target.closest(".pro-console")) syncProControls();
});
syncProControls();

document.querySelector<HTMLButtonElement>("#settings-export")!.addEventListener("click", () => {
  const textarea = document.querySelector<HTMLTextAreaElement>("#settings-json")!;
  const status = document.querySelector<HTMLParagraphElement>("#settings-status")!;
  const state = {
    version: 1 as const,
    synth: structuredClone(settings),
    effects: structuredClone(effectSettings),
    routing: structuredClone(routing),
    midi: structuredClone(loadedMidi)
  };
  const text = stringifyAppSettings(state);
  textarea.value = text;
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "pico-synth-settings.json";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  status.textContent = "JSONを書き出しました。テキストをコピーするか、ファイルを保存してください。";
});

document.querySelector<HTMLButtonElement>("#settings-import")!.addEventListener("click", () => {
  const textarea = document.querySelector<HTMLTextAreaElement>("#settings-json")!;
  const status = document.querySelector<HTMLParagraphElement>("#settings-status")!;
  try {
    const imported = parseAppSettings(textarea.value);
    stopMidiTransport(true);
    Object.assign(settings, imported.synth);
    Object.assign(effectSettings, imported.effects);
    routing = imported.routing;
    loadedMidi = imported.midi;
    syncSettingsToUI();
    engine.setSettings(settings);
    const midiStatus = document.querySelector<HTMLParagraphElement>("#midi-status")!;
    const playButton = document.querySelector<HTMLButtonElement>("#midi-play")!;
    const stopButton = document.querySelector<HTMLButtonElement>("#midi-stop")!;
    const progress = document.querySelector<HTMLProgressElement>("#midi-progress")!;
    playButton.disabled = !loadedMidi?.notes.length;
    stopButton.disabled = !loadedMidi?.notes.length;
    if (loadedMidi) {
      midiStatus.textContent = `${loadedMidi.fileName} · ${loadedMidi.notes.length.toLocaleString()} 音 · ${loadedMidi.trackCount} トラック`;
      progress.max = loadedMidi.duration;
      progress.value = 0;
    } else {
      midiStatus.textContent = "MIDIノートは設定に含まれていません。";
      progress.max = 1;
      progress.value = 0;
    }
    midiInput.value = "";
    const graphReady = rebuildEffectsGraph();
    status.textContent = graphReady
      ? "設定を読み込みました。音色、配線、MIDIノートを復元しました。"
      : document.querySelector<HTMLParagraphElement>("#route-message")!.textContent;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "設定を読み込めませんでした。";
  }
});

const midiInput = document.querySelector<HTMLInputElement>("#midi-file")!;
const midiStatus = document.querySelector<HTMLParagraphElement>("#midi-status")!;
const midiPlayButton = document.querySelector<HTMLButtonElement>("#midi-play")!;
const midiStopButton = document.querySelector<HTMLButtonElement>("#midi-stop")!;
const midiProgress = document.querySelector<HTMLProgressElement>("#midi-progress")!;

function syncProMidiControls(): void {
  const play = document.querySelector<HTMLButtonElement>("#pro-midi-play")!;
  const stop = document.querySelector<HTMLButtonElement>("#pro-midi-stop")!;
  const loop = document.querySelector<HTMLInputElement>("#pro-midi-loop")!;
  const status = document.querySelector<HTMLElement>("#pro-midi-status")!;
  document.querySelector<HTMLSelectElement>("#pro-midi-sample")!.value =
    document.querySelector<HTMLSelectElement>("#midi-sample")!.value;
  play.disabled = midiPlayButton.disabled;
  stop.disabled = midiStopButton.disabled;
  loop.checked = document.querySelector<HTMLInputElement>("#midi-loop")!.checked;
  status.textContent = loadedMidi ? `${loadedMidi.fileName} · ${loadedMidi.notes.length} NOTES` : "SELECT A MIDI SAMPLE";
}

function setLoadedMidi(clip: MidiClip, statusText?: string): void {
  stopMidiTransport(true);
  loadedMidi = clip;
  midiPlayButton.disabled = loadedMidi.notes.length === 0;
  midiStopButton.disabled = loadedMidi.notes.length === 0;
  midiStatus.textContent = statusText ?? `${clip.fileName} · ${clip.notes.length.toLocaleString()} 音 · ${clip.trackCount} トラック · ${Math.floor(clip.duration / 60)}:${String(Math.floor(clip.duration % 60)).padStart(2, "0")}`;
  midiProgress.max = Math.max(clip.duration, 1);
  midiProgress.value = 0;
  syncProMidiControls();
}

async function loadMidiSample(sampleId: string): Promise<void> {
  const sample = midiSamples.find(([id]) => id === sampleId);
  if (!sample) throw new Error("MIDIサンプルが見つかりません。");
  const response = await fetch(new URL(`midi/${sample[0]}.mid`, document.baseURI));
  if (!response.ok) throw new Error(`MIDIサンプルを読み込めませんでした（HTTP ${response.status}）。`);
  setLoadedMidi(parseMidiFile(await response.arrayBuffer(), `${sample[1]}.mid`), `${sample[2]} / ${sample[1]} · MIDIサンプルを読み込みました`);
}

document.querySelector<HTMLSelectElement>("#midi-sample")!.addEventListener("change", (event) => {
  document.querySelector<HTMLSelectElement>("#pro-midi-sample")!.value = (event.currentTarget as HTMLSelectElement).value;
});
document.querySelector<HTMLSelectElement>("#pro-midi-sample")!.addEventListener("change", (event) => {
  document.querySelector<HTMLSelectElement>("#midi-sample")!.value = (event.currentTarget as HTMLSelectElement).value;
});
document.querySelector<HTMLInputElement>("#pro-midi-loop")!.addEventListener("change", (event) => {
  document.querySelector<HTMLInputElement>("#midi-loop")!.checked = (event.currentTarget as HTMLInputElement).checked;
});
document.querySelector<HTMLButtonElement>("#pro-midi-load")!.addEventListener("click", () => {
  document.querySelector<HTMLButtonElement>("#midi-sample-load")!.click();
});
document.querySelector<HTMLButtonElement>("#pro-midi-play")!.addEventListener("click", () => midiPlayButton.click());
document.querySelector<HTMLButtonElement>("#pro-midi-stop")!.addEventListener("click", () => midiStopButton.click());
document.querySelector<HTMLButtonElement>("#midi-sample-load")!.addEventListener("click", async () => {
  const button = document.querySelector<HTMLButtonElement>("#midi-sample-load")!;
  button.disabled = true;
  midiStatus.textContent = "MIDIサンプルを読み込み中…";
  try {
    await loadMidiSample(document.querySelector<HTMLSelectElement>("#midi-sample")!.value);
  } catch (error) {
    midiStatus.textContent = error instanceof Error ? error.message : "MIDIサンプルを読み込めませんでした。";
  } finally {
    button.disabled = false;
    syncProMidiControls();
  }
});
syncProMidiControls();

const presetLoadButton = document.querySelector<HTMLButtonElement>("#preset-load")!;
presetLoadButton.addEventListener("click", () => {
  document.querySelector<HTMLSelectElement>("#pro-preset-select")!.value =
    document.querySelector<HTMLSelectElement>("#preset-select")!.value;
});
document.querySelector<HTMLSelectElement>("#pro-preset-select")!.addEventListener("change", (event) => {
  document.querySelector<HTMLSelectElement>("#preset-select")!.value = (event.currentTarget as HTMLSelectElement).value;
});
document.querySelector<HTMLButtonElement>("#pro-preset-load")!.addEventListener("click", () => {
  document.querySelector<HTMLSelectElement>("#preset-select")!.value =
    document.querySelector<HTMLSelectElement>("#pro-preset-select")!.value;
  presetLoadButton.click();
});
document.querySelector<HTMLSelectElement>("#preset-select")!.addEventListener("change", () => {
  document.querySelector<HTMLSelectElement>("#pro-preset-select")!.value =
    document.querySelector<HTMLSelectElement>("#preset-select")!.value;
});
presetLoadButton.addEventListener("click", async () => {
  const presetName = document.querySelector<HTMLSelectElement>("#preset-select")!.value;
  const status = document.querySelector<HTMLParagraphElement>("#preset-status")!;
  presetLoadButton.disabled = true;
  status.textContent = "サンプル音色を読み込み中…";
  try {
    const response = await fetch(new URL(`presets/${presetName}.json`, document.baseURI));
    if (!response.ok) throw new Error(`サンプル音色を読み込めませんでした（HTTP ${response.status}）。`);
    const imported = parseAppSettings(await response.text());
    stopMidiTransport(true);
    Object.assign(settings, imported.synth);
    Object.assign(effectSettings, imported.effects);
    routing = imported.routing;
    loadedMidi = imported.midi;
    syncSettingsToUI();
    engine.setSettings(settings);
    midiPlayButton.disabled = !loadedMidi?.notes.length;
    midiStopButton.disabled = !loadedMidi?.notes.length;
    midiStatus.textContent = "サンプル音色を読み込みました。";
    midiProgress.max = 1;
    midiProgress.value = 0;
    const graphReady = rebuildEffectsGraph();
    status.textContent = graphReady ? "サンプル音色を読み込みました。" : document.querySelector<HTMLParagraphElement>("#route-message")!.textContent;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "サンプル音色を読み込めませんでした。";
  } finally {
    presetLoadButton.disabled = false;
  }
});

midiInput.addEventListener("change", async () => {
  const file = midiInput.files?.[0];
  if (!file) return;
  if (!/\.(mid|midi)$/i.test(file.name)) {
    stopMidiTransport(true);
    loadedMidi = null;
    midiPlayButton.disabled = true;
    midiStopButton.disabled = true;
    syncProMidiControls();
    midiStatus.textContent = "拡張子が .mid または .midi のファイルを選んでください。";
    midiInput.value = "";
    return;
  }
  midiPlayButton.disabled = true;
  try {
    setLoadedMidi(parseMidiFile(await file.arrayBuffer(), file.name));
  } catch (error) {
    loadedMidi = null;
    midiInput.value = "";
    midiStatus.textContent = error instanceof Error ? error.message : "MIDIファイルを読み込めませんでした。";
    midiStopButton.disabled = true;
    syncProMidiControls();
  }
});

midiPlayButton.addEventListener("click", () => {
  if (!loadedMidi) return;
  try {
    midiPlayer.play(
      loadedMidi,
      document.querySelector<HTMLInputElement>("#midi-loop")!.checked,
      (seconds) => { midiProgress.value = seconds; },
      () => { midiStatus.textContent = `${loadedMidi?.fileName ?? "曲"} の再生が終わりました。`; }
    );
    midiStatus.textContent = `${loadedMidi.fileName} を再生中…`;
    syncProMidiControls();
  } catch (error) {
    midiStatus.textContent = error instanceof Error ? error.message : "再生を開始できませんでした。";
  }
});

midiStopButton.addEventListener("click", () => {
  stopMidiTransport(true);
  if (loadedMidi) midiStatus.textContent = `${loadedMidi.fileName} を停止しました。`;
  syncProMidiControls();
});

document.querySelectorAll<HTMLButtonElement>(".key").forEach((key) => {
  const note = Number(key.dataset.note);
  key.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    key.setPointerCapture(event.pointerId);
    const pointers = activePointerNotes.get(note) ?? new Set<number>();
    pointers.add(event.pointerId);
    activePointerNotes.set(note, pointers);
    startNote(note);
  });
  const releasePointerNote = (event: PointerEvent) => {
    const pointers = activePointerNotes.get(note);
    pointers?.delete(event.pointerId);
    if (pointers?.size === 0) activePointerNotes.delete(note);
    if (!activePointerNotes.has(note) && ![...activePhysicalKeys.values()].includes(note)) stopNote(note);
  };
  key.addEventListener("pointerup", releasePointerNote);
  key.addEventListener("pointercancel", releasePointerNote);
  key.addEventListener("lostpointercapture", releasePointerNote);
});

window.addEventListener("keydown", (event) => {
  const target = event.target instanceof HTMLElement
    ? {
      tagName: event.target.tagName,
      inputType: event.target instanceof HTMLInputElement ? event.target.type : undefined,
      isContentEditable: event.target.isContentEditable
    }
    : null;
  const note = pianoNoteForKey(event.code, event.repeat, target, event.altKey || event.ctrlKey || event.metaKey);
  if (note === null) return;
  event.preventDefault();
  if (activePhysicalKeys.has(event.code)) return;
  activePhysicalKeys.set(event.code, note);
  startNote(note);
});
window.addEventListener("keyup", (event) => {
  const note = activePhysicalKeys.get(event.code);
  if (note === undefined) return;
  event.preventDefault();
  activePhysicalKeys.delete(event.code);
  if (![...activePhysicalKeys.values()].includes(note) && !activePointerNotes.has(note)) stopNote(note);
});
window.addEventListener("blur", releaseKeyboardNotes);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) releaseKeyboardNotes();
});

document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-osc]").forEach((control) => {
  const update = (event: Event) => {
    const index = Number(control.dataset.osc) as 0 | 1;
    const prop = control.dataset.prop;
    if (prop === "semitones" && (control.value.trim() === "" || !Number.isFinite(Number(control.value)))) {
      if (event.type === "change") control.value = String(settings.oscillators[index].semitones);
      return;
    }
    const value = control instanceof HTMLInputElement && control.type === "range"
      ? Number(control.value)
      : control.value;
    if (prop === "waveform") settings.oscillators[index].waveform = value as Waveform;
    if (prop === "volume") settings.oscillators[index].volume = clamp(Number(value), 0, 1);
    if (prop === "semitones") settings.oscillators[index].semitones = clamp(Math.round(Number(value)), -48, 48);
    if (prop === "cents") settings.oscillators[index].cents = clamp(Number(value), -100, 100);
    const normalized = prop === "waveform" ? settings.oscillators[index].waveform :
      prop === "volume" ? settings.oscillators[index].volume :
      prop === "semitones" ? settings.oscillators[index].semitones : settings.oscillators[index].cents;
    control.value = String(normalized);
    if (prop === "waveform") {
      const path = document.querySelector<SVGPathElement>(`#wave-visual-${index}`);
      if (path) path.setAttribute("d", waveformPath(settings.oscillators[index].waveform));
    }
    if (prop === "volume" || prop === "cents") {
      const output = control.parentElement?.querySelector("output");
      if (output) output.value = prop === "volume" ? `${Math.round(Number(value) * 100)}%` : String(value);
    }
    applySettings();
  };
  control.addEventListener("input", update);
  control.addEventListener("change", update);
});

const fmEnabledControl = document.querySelector<HTMLInputElement>("#fm-enabled")!;
const fmDepthControl = document.querySelector<HTMLInputElement>("#fm-depth")!;
fmEnabledControl.addEventListener("change", () => {
  settings.fmEnabled = fmEnabledControl.checked;
  fmDepthControl.disabled = !settings.fmEnabled;
  const volumeLabel = document.querySelector<HTMLLabelElement>('label[for="volume-1"] .parameter-name');
  if (volumeLabel) volumeLabel.textContent = settings.fmEnabled ? "変調量" : "音量";
  applySettings();
});
fmDepthControl.addEventListener("input", () => {
  settings.fmDepth = clamp(Number(fmDepthControl.value), 0, 1000);
  fmDepthControl.value = String(settings.fmDepth);
  const output = fmDepthControl.parentElement?.querySelector("output");
  if (output) output.value = `${settings.fmDepth} Hz`;
  applySettings();
});

document.querySelectorAll<HTMLButtonElement>(".step-button").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.target ?? "") as HTMLInputElement | null;
    if (!input) return;
    input.value = String(clamp(Number(input.value) + Number(button.dataset.step), -48, 48));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
});

function envelopeSettings(index: 0 | 1): SynthSettings["envelope"] {
  return index === 0 ? settings.envelope : settings.envelope2;
}

document.querySelector<HTMLInputElement>("#envelope2-enabled")!.addEventListener("change", (event) => {
  settings.envelope2Enabled = (event.currentTarget as HTMLInputElement).checked;
  const channel = document.querySelector<HTMLElement>('[data-envelope-channel="1"]')!;
  channel.classList.toggle("is-disabled", !settings.envelope2Enabled);
  channel.querySelectorAll<HTMLInputElement>("[data-envelope-part]").forEach((input) => {
    input.disabled = !settings.envelope2Enabled;
  });
  channel.querySelectorAll<SVGCircleElement>("[data-envelope-handle]").forEach((handle) => {
    handle.tabIndex = settings.envelope2Enabled ? 0 : -1;
    handle.setAttribute("aria-disabled", String(!settings.envelope2Enabled));
  });
  applySettings();
});

document.querySelectorAll<HTMLInputElement>("[data-envelope-part]").forEach((input) => {
  const update = (format: boolean) => {
    const index = Number(input.dataset.envelopeIndex) as 0 | 1;
    const part = input.dataset.envelopePart as EnvelopeControl;
    const envelope = envelopeSettings(index);
    if (input.value.trim() === "") {
      if (format) input.value = formatEnvelopeControl(part, envelope[part]);
      return;
    }
    const raw = Number(input.value);
    if (!Number.isFinite(raw)) {
      if (format) input.value = formatEnvelopeControl(part, envelope[part]);
      return;
    }
    envelope[part] = normalizeEnvelopeControl(part, raw);
    if (format) input.value = formatEnvelopeControl(part, envelope[part]);
    drawEnvelope(index);
    applySettings();
  };
  input.addEventListener("input", () => update(false));
  input.addEventListener("change", () => update(true));
});

document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-lfo]").forEach((control) => {
  const update = (event: Event) => {
    const key = control.dataset.lfo as "pitchLfo" | "volumeLfo";
    const prop = control.dataset.prop as "enabled" | "waveform" | "frequency" | "depth";
    const lfo = settings[key];
    if (prop === "frequency" && control instanceof HTMLInputElement &&
        (control.value.trim() === "" || !Number.isFinite(Number(control.value)))) {
      if (event.type === "change") control.value = formatLfoFrequency(lfo.frequency);
      return;
    }
    if (prop === "enabled" && control instanceof HTMLInputElement) lfo.enabled = control.checked;
    if (prop === "waveform") lfo.waveform = control.value as typeof lfo.waveform;
    if (prop === "frequency" && control instanceof HTMLInputElement) {
      lfo.frequency = control.type === "range"
        ? lfoSliderToFrequency(Number(control.value))
        : normalizeLfoFrequency(Number(control.value));
      document.querySelector<HTMLInputElement>(`#${key}-freq`)!.value = String(lfoFrequencyToSlider(lfo.frequency));
      document.querySelector<HTMLInputElement>(`#${key}-freq-number`)!.value = formatLfoFrequency(lfo.frequency);
    }
    if (prop === "depth") lfo.depth = clamp(Number(control.value), 0, key === "pitchLfo" ? 200 : 0.5);
    const output = prop === "frequency"
      ? document.querySelector<HTMLInputElement>(`#${key}-freq`)?.parentElement?.querySelector("output")
      : control.parentElement?.querySelector("output");
    if (output && prop !== "enabled" && prop !== "waveform") {
      output.value = prop === "frequency" ? `${formatLfoFrequency(lfo.frequency)} Hz${lfo.frequency > 20 ? " · 音声レート" : ""}` : `${lfo.depth}${key === "pitchLfo" ? "¢" : ""}`;
    }
    if (prop === "waveform") {
      const path = document.querySelector<SVGPathElement>(`#${key}-wave-visual`);
      if (path) path.setAttribute("d", waveformPath(lfo.waveform));
    }
    applySettings();
  };
  control.addEventListener("input", update);
  control.addEventListener("change", update);
});

function drawEnvelope(index: 0 | 1): void {
  const prefix = `envelope-${index}`;
  const envelope = envelopeSettings(index);
  const { attack, decay, sustain, release } = envelope;
  const scale = 305 / (attack + decay + 0.55 + release);
  const xAttack = 28 + attack * scale;
  const xSustain = xAttack + decay * scale;
  const xOff = xSustain + 0.55 * scale;
  const xEnd = xOff + release * scale;
  const ySustain = 25 + (1 - sustain) * 66;
  document.querySelector<SVGPathElement>(`#${prefix}-path`)!.setAttribute(
    "d",
    `M 24 96 L ${xAttack} 25 L ${xSustain} ${ySustain} L ${xOff} ${ySustain} L ${xEnd} 96`
  );
  const values = { attack: [xAttack, 25, attack], sustain: [xSustain, ySustain, sustain * 100], release: [xEnd, 96, release] };
  for (const [part, [x, y, value]] of Object.entries(values)) {
    const handle = document.querySelector<SVGCircleElement>(`#${prefix}-handle-${part}`)!;
    handle.setAttribute("cx", String(x));
    handle.setAttribute("cy", String(y));
    handle.setAttribute("aria-valuenow", value.toFixed(2));
  }
}
drawEnvelope(0);
drawEnvelope(1);

let dragHandle: { index: 0 | 1; part: "attack" | "sustain" | "release" } | null = null;
function updateEnvelopeFromPointer(event: PointerEvent): void {
  if (!dragHandle) return;
  const envelope = envelopeSettings(dragHandle.index);
  const svg = document.querySelector<SVGSVGElement>(`#envelope-${dragHandle.index}-svg`)!;
  const bounds = svg.getBoundingClientRect();
  const x = (event.clientX - bounds.left) * 400 / bounds.width;
  const y = (event.clientY - bounds.top) * 130 / bounds.height;
  const { attack, decay, release } = envelope;
  const scale = 305 / (attack + decay + 0.55 + release);
  if (dragHandle.part === "attack") envelope.attack = clamp((x - 28) / scale, 0.001, 5);
  if (dragHandle.part === "sustain") {
    envelope.decay = clamp((x - 28 - envelope.attack * scale) / scale, 0.001, 5);
    envelope.sustain = clamp(1 - (y - 25) / 66, 0, 1);
  }
  if (dragHandle.part === "release") {
    const xOff = 28 + envelope.attack * scale + envelope.decay * scale + 0.55 * scale;
    envelope.release = clamp((x - xOff) / scale, 0.001, 5);
  }
  for (const [key, value] of Object.entries(envelope)) {
    const input = document.querySelector<HTMLInputElement>(`[data-envelope-index="${dragHandle.index}"][data-envelope-part="${key}"]`);
    if (input) input.value = formatEnvelopeControl(key as EnvelopeControl, value);
  }
  drawEnvelope(dragHandle.index);
  applySettings();
}
document.querySelectorAll<SVGCircleElement>("[data-envelope-handle]").forEach((handle) => {
  const index = Number(handle.closest("[data-envelope-channel]")?.getAttribute("data-envelope-channel")) as 0 | 1;
  const part = handle.dataset.envelopeHandle as "attack" | "sustain" | "release";
  handle.addEventListener("pointerdown", (event) => {
    dragHandle = { index, part };
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  handle.addEventListener("pointermove", updateEnvelopeFromPointer);
  handle.addEventListener("pointerup", () => { dragHandle = null; });
  handle.addEventListener("pointercancel", () => { dragHandle = null; });
  handle.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -0.05 : 0.05;
    const envelope = envelopeSettings(index);
    if (part === "attack") envelope.attack = clamp(envelope.attack + delta, 0.001, 5);
    if (part === "release") envelope.release = clamp(envelope.release + delta, 0.001, 5);
    if (part === "sustain") envelope.sustain = clamp(envelope.sustain - delta, 0, 1);
    const input = document.querySelector<HTMLInputElement>(`[data-envelope-index="${index}"][data-envelope-part="${part}"]`);
    if (input) input.value = formatEnvelopeControl(part, envelope[part]);
    drawEnvelope(index);
    applySettings();
  });
});
