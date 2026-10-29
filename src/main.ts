import "./style.css";
import { AudioEngine } from "./audio/engine";
import { clamp, defaultSynthSettings, type SynthSettings, type Waveform } from "./model/config";
import { MidiPlayer } from "./midi/player";
import { parseMidiFile, type MidiClip } from "./midi/parser";
import {
  defaultEffects,
  defaultRouting,
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
  lfoFrequencyToSlider,
  lfoSliderToFrequency,
  normalizeEnvelopeControl,
  type EnvelopeControl
} from "./model/controls";
import { pianoNoteForKey } from "./ui/keyboard";
import { effectPreviewSvg, waveformPath } from "./ui/visualizations";

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
        <div class="tune-inputs"><button type="button" class="step-button" data-step="-1" data-target="semitone-${index}" aria-label="オシレーター${index + 1}の半音を下げる Coarse Tune">−</button><input id="semitone-${index}" type="number" min="-24" max="24" step="1" value="${oscillator.semitones}" data-osc="${index}" data-prop="semitones" aria-label="オシレーター${index + 1}の半音 Coarse Tune"><button type="button" class="step-button" data-step="1" data-target="semitone-${index}" aria-label="オシレーター${index + 1}の半音を上げる Coarse Tune">＋</button></div>
      </div>
      <div class="range-row compact"><label for="cents-${index}"><span class="parameter-name">微調整 <span class="helper">セント</span></span><span class="parameter-term">Fine Tune</span></label><input id="cents-${index}" type="range" min="-100" max="100" step="1" value="${oscillator.cents}" data-osc="${index}" data-prop="cents" aria-label="オシレーター${index + 1}の微調整 (Fine Tune)"><output>${oscillator.cents}</output></div>
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
    <nav class="tabs" aria-label="音づくりの画面"><button class="tab active" type="button" data-tab="synth" aria-current="page"><span aria-hidden="true">🎛️</span> 音づくり</button><button class="tab" type="button" data-tab="effects"><span aria-hidden="true">✨</span> エフェクト</button></nav>
    <section id="synth-view" class="view-panel">
    <section class="workspace">
      <section class="panel card" aria-labelledby="osc-title">
        <div class="panel-heading"><div><p class="eyebrow">SHAPE YOUR SOUND</p><h2 id="osc-title">音のもとをえらぼう</h2></div><span class="step-badge">01 · 波</span></div>
        <p class="panel-copy">2つの音を重ねると、もっとゆたかな音になるよ。発音数 Polyphony は最大8音です。</p>
        <div class="oscillator-grid">${oscillatorCard(0)}${oscillatorCard(1)}</div>
      </section>
      <section class="panel card" aria-labelledby="env-title">
        <div class="panel-heading"><div><p class="eyebrow">SHAPE THE VOLUME</p><h2 id="env-title">音のふくらみをつくろう</h2></div><span class="step-badge badge-mint">02 · ADSR · Envelope</span></div>
        <p class="panel-copy">音が大きくなって、続いて、小さくなる形をえがこう。</p>
        <div class="envelope-graph"><svg id="envelope-svg" viewBox="0 0 400 130" role="img" aria-label="音量エンベロープ。丸い点をドラッグして形を変えられます"><path class="envelope-grid" d="M24 25 H376 M24 60 H376 M24 96 H376 M110 18 V102 M200 18 V102 M290 18 V102"></path><path id="envelope-path" d=""></path><text class="envelope-axis" x="27" y="17">音量</text><text class="envelope-axis" x="355" y="119">時間</text><circle id="handle-attack" class="envelope-handle" data-handle="attack" r="7" tabindex="0" role="slider" aria-valuemin="0.01" aria-valuemax="5" aria-label="アタック時間 Attack を調整"></circle><circle id="handle-sustain" class="envelope-handle" data-handle="sustain" r="7" tabindex="0" role="slider" aria-valuemin="0" aria-valuemax="100" aria-label="サステイン量 Sustain を調整"></circle><circle id="handle-release" class="envelope-handle" data-handle="release" r="7" tabindex="0" role="slider" aria-valuemin="0.01" aria-valuemax="5" aria-label="リリース時間 Release を調整"></circle></svg><div class="envelope-stages" aria-hidden="true"><span>押す<small>Note On</small></span><span>ふくらむ<small>Attack</small></span><span>保つ<small>Sustain</small></span><span>はなす<small>Release</small></span></div></div>
        <div class="adsr-grid">
          ${(["attack", "decay", "sustain", "release"] as const).map((part, i) => `<label class="adsr-field" for="env-${part}"><span>${["A", "D", "S", "R"][i]} <small>${["ふくらむ", "落ち着く", "保つ", "消える"][i]}</small><span class="parameter-term">${["Attack", "Decay", "Sustain", "Release"][i]}</span></span><span class="number-with-unit"><input id="env-${part}" type="number" min="${part === "sustain" ? 0 : 0.01}" max="${part === "sustain" ? 100 : 5}" step="0.01" value="${formatEnvelopeControl(part, settings.envelope[part])}" data-envelope="${part}" aria-label="${["ふくらむ Attack", "落ち着く Decay", "保つ Sustain", "消える Release"][i]}"><span>${part === "sustain" ? "%" : "秒"}</span></span></label>`).join("")}
        </div>
      </section>
      <section class="panel card" aria-labelledby="lfo-title">
        <div class="panel-heading"><div><p class="eyebrow">ADD A LITTLE MOVEMENT</p><h2 id="lfo-title">ゆらぎをつけよう</h2></div><span class="step-badge badge-pink">03 · LFO</span></div>
        <p class="panel-copy">音にゆらぎを加えるしくみ。20Hz以上は、音色が変わる音声レートのゆらぎだよ。</p>
        <div class="lfo-grid">
          ${(["pitchLfo", "volumeLfo"] as const).map((key) => {
            const lfo = settings[key];
            const pitch = key === "pitchLfo";
            return `<article class="control-card lfo-card"><div class="lfo-title-row"><label class="switch-label" for="${key}-enabled"><input id="${key}-enabled" type="checkbox" data-lfo="${key}" data-prop="enabled" ${lfo.enabled ? "checked" : ""}><span class="switch"></span><span class="parameter-pair"><span>${pitch ? "音程のゆらぎ" : "音量のゆらぎ"}</span><span class="parameter-term">${pitch ? "Pitch LFO · On / Off" : "Amplitude LFO (Tremolo) · On / Off"}</span></span></label><span class="lfo-icon" aria-hidden="true">${pitch ? "↕" : "〰"}</span></div><div class="lfo-wave-visual"><svg viewBox="0 0 200 48" aria-hidden="true"><path id="${key}-wave-visual" d="${waveformPath(lfo.waveform)}"></path></svg></div><label class="field-label" for="${key}-wave"><span class="parameter-name">ゆらぎの形</span><span class="parameter-term">Waveform</span></label><select id="${key}-wave" data-lfo="${key}" data-prop="waveform"><option value="sine" ${lfo.waveform === "sine" ? "selected" : ""}>なめらか / Sine</option><option value="triangle" ${lfo.waveform === "triangle" ? "selected" : ""}>三角 / Triangle</option><option value="square" ${lfo.waveform === "square" ? "selected" : ""}>カクカク / Square</option><option value="sawtooth" ${lfo.waveform === "sawtooth" ? "selected" : ""}>ノコギリ / Sawtooth</option></select><div class="range-row lfo-range-row"><label for="${key}-freq"><span class="parameter-name">速さ（Hz）</span><span class="parameter-term">Rate · 対数スケール</span></label><input id="${key}-freq" type="range" min="0" max="10000" step="1" value="${lfoFrequencyToSlider(lfo.frequency)}" data-lfo="${key}" data-prop="frequency" aria-label="ゆらぎの速さ Rate, 0.1から2000ヘルツ"><output>${lfo.frequency} Hz</output></div><div class="range-row lfo-range-row compact"><label for="${key}-depth"><span class="parameter-name">深さ</span><span class="parameter-term">Depth</span></label><input id="${key}-depth" type="range" min="0" max="${pitch ? 200 : 0.5}" step="${pitch ? 1 : 0.01}" value="${lfo.depth}" data-lfo="${key}" data-prop="depth" aria-label="ゆらぎの深さ Depth"><output>${lfo.depth}${pitch ? "¢" : ""}</output></div></article>`;
          }).join("")}
        </div>
      </section>
      <section class="panel card keyboard-panel" aria-labelledby="keyboard-title">
        <div class="panel-heading"><div><p class="eyebrow">PLAY A NOTE</p><h2 id="keyboard-title">鍵盤をひいてみよう</h2></div><span class="step-badge badge-yellow">🎹 1オクターブ</span></div>
        <p class="panel-copy">鍵盤を押している間、音が鳴るよ。下のPCキーでもひけます。</p>
        <div class="keyboard" role="group" aria-label="1オクターブのピアノ鍵盤">
          ${Array.from({ length: 13 }, (_, i) => `<button type="button" class="key ${[1, 3, 6, 8, 10].includes(i) ? "black-key" : "white-key"}" data-note="${60 + i}" aria-label="${["ド", "ドのシャープ", "レ", "レのシャープ", "ミ", "ファ", "ファのシャープ", "ソ", "ソのシャープ", "ラ", "ラのシャープ", "シ", "高いド"][i]}"><span>${i === 0 ? "C" : i === 2 ? "D" : i === 4 ? "E" : i === 5 ? "F" : i === 7 ? "G" : i === 9 ? "A" : i === 11 ? "B" : ""}</span></button>`).join("")}
        </div>
        <div class="key-shortcuts" aria-label="パソコンの音階キー"><span>PC</span>${["A", "W", "S", "E", "D", "F", "T", "G", "Y", "H", "U", "J", "K"].map((key) => `<kbd>${key}</kbd>`).join("")}</div>
        <p class="key-hint" id="key-hint" aria-live="polite">音の準備をしたら、鍵盤を押してね</p>
      </section>
      <section class="panel card midi-panel" aria-labelledby="midi-title">
        <div class="panel-heading"><div><p class="eyebrow">PLAY YOUR OWN MUSIC</p><h2 id="midi-title">MIDIファイルをひいてみよう</h2></div><span class="step-badge badge-blue">04 · MIDI</span></div>
        <p class="panel-copy">標準MIDIファイルを読み込んで再生できます。複数のトラックはまとめて鳴り、音の強さ Velocity も反映します。</p>
        <div class="midi-controls">
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
  const controls: Record<EffectId, Array<[string, string, string, number, number, number, string]>> = {
    distortion: [["drive", "歪み", "Drive", 0, 100, 1, "%"], ["wet", "音の混ざり", "Mix (Wet/Dry)", 0, 1, 0.01, "%"]],
    chorus: [["rate", "ゆらぐ速さ", "Rate", 0.1, 10, 0.1, "Hz"], ["depth", "ゆらぐ幅", "Depth", 0.001, 0.05, 0.001, "秒"], ["wet", "音の混ざり", "Mix (Wet/Dry)", 0, 1, 0.01, "%"]],
    compressor: [["threshold", "音を整えはじめる音量", "Threshold", -100, 0, 1, "dB"], ["ratio", "整える強さ", "Ratio", 1, 20, 0.1, ":1"]],
    eq: [["frequency", "変える音の高さ", "Frequency", 20, 20000, 10, "Hz"], ["q", "変える幅", "Q", 0.1, 18, 0.1, ""], ["gain", "音の上げ下げ", "Gain", -24, 24, 0.5, "dB"], ["wet", "音の混ざり", "Mix (Wet/Dry)", 0, 1, 0.01, "%"]],
    delay: [["time", "やまびこの間隔", "Delay Time", 0.01, 2, 0.01, "秒"], ["feedback", "やまびこの回数", "Feedback", 0, 0.8, 0.01, ""], ["wet", "音の混ざり", "Mix (Wet/Dry)", 0, 1, 0.01, "%"]],
    reverb: [["decay", "ひびきの長さ", "Decay Time", 0.1, 5, 0.1, "秒"], ["wet", "音の混ざり", "Mix (Wet/Dry)", 0, 1, 0.01, "%"]]
  };
  return `<article class="effect-card"><div class="effect-heading"><label class="switch-label" for="effect-${id}"><input id="effect-${id}" type="checkbox" data-effect="${id}" data-prop="enabled" ${config.enabled ? "checked" : ""}><span class="switch"></span><span class="parameter-pair"><span>${effectNames[id]}</span><span class="parameter-term">${effectTerms[id]} · On / Bypass</span></span></label><span class="effect-symbol" aria-hidden="true">${["✦", "〰", "↘", "◒", "↗", "☁"][(["distortion", "chorus", "compressor", "eq", "delay", "reverb"] as EffectId[]).indexOf(id)]}</span></div><div class="effect-visual"><span>音の変化</span><span class="effect-visual-flow">入力 → 出力</span><div id="effect-visual-${id}">${effectPreviewSvg(id, effectSettings)}</div></div><div class="effect-controls">${controls[id].map(([prop, label, term, min, max, step, unit]) => {
    const value = effectValue(id, prop);
    const shown = unit === "%" ? `${Math.round(value * (prop === "wet" ? 100 : 1))}%` : `${value}${unit ? ` ${unit}` : ""}`;
    return `<label class="effect-control" for="${id}-${prop}"><span class="parameter-pair"><span>${label}</span><span class="parameter-term">${term}</span></span><input id="${id}-${prop}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-effect="${id}" data-prop="${prop}" aria-label="${label} ${term}"><output>${shown}</output></label>`;
  }).join("")}</div></article>`;
}

function effectValue(id: EffectId, prop: string): number {
  if (id === "distortion") return prop === "drive" ? effectSettings.distortion.drive : effectSettings.distortion.wet;
  if (id === "chorus") {
    if (prop === "rate") return effectSettings.chorus.rate;
    if (prop === "depth") return effectSettings.chorus.depth;
    return effectSettings.chorus.wet;
  }
  if (id === "compressor") return prop === "threshold" ? effectSettings.compressor.threshold : effectSettings.compressor.ratio;
  if (id === "eq") {
    if (prop === "frequency") return effectSettings.eq.frequency;
    if (prop === "q") return effectSettings.eq.q;
    if (prop === "gain") return effectSettings.eq.gain;
    return effectSettings.eq.wet;
  }
  if (id === "delay") {
    if (prop === "time") return effectSettings.delay.time;
    if (prop === "feedback") return effectSettings.delay.feedback;
    return effectSettings.delay.wet;
  }
  return prop === "decay" ? effectSettings.reverb.decay : effectSettings.reverb.wet;
}

function isEffectId(value: string): value is EffectId {
  return Object.hasOwn(effectNames, value);
}

function updateEffectSetting(id: EffectId, prop: string, value: boolean | number): void {
  const isToggle = prop === "enabled";
  if (id === "distortion") {
    if (isToggle && typeof value === "boolean") effectSettings.distortion.enabled = value;
    else if (prop === "drive" && typeof value === "number") effectSettings.distortion.drive = value;
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
  } else if (id === "eq") {
    if (isToggle && typeof value === "boolean") effectSettings.eq.enabled = value;
    else if (prop === "frequency" && typeof value === "number") effectSettings.eq.frequency = value;
    else if (prop === "q" && typeof value === "number") effectSettings.eq.q = value;
    else if (prop === "gain" && typeof value === "number") effectSettings.eq.gain = value;
    else if (prop === "wet" && typeof value === "number") effectSettings.eq.wet = value;
  } else if (id === "delay") {
    if (isToggle && typeof value === "boolean") effectSettings.delay.enabled = value;
    else if (prop === "time" && typeof value === "number") effectSettings.delay.time = value;
    else if (prop === "feedback" && typeof value === "number") effectSettings.delay.feedback = value;
    else if (prop === "wet" && typeof value === "number") effectSettings.delay.wet = value;
  } else {
    if (isToggle && typeof value === "boolean") effectSettings.reverb.enabled = value;
    else if (prop === "decay" && typeof value === "number") effectSettings.reverb.decay = value;
    else if (prop === "wet" && typeof value === "number") effectSettings.reverb.wet = value;
  }
}

function updateEffectPreview(id: EffectId): void {
  const preview = document.querySelector<HTMLDivElement>(`#effect-visual-${id}`);
  if (preview) preview.innerHTML = effectPreviewSvg(id, effectSettings);
}

document.querySelectorAll<HTMLInputElement>("[data-effect]").forEach((control) => {
  const update = (rebuild: boolean) => {
    const id = control.dataset.effect;
    const prop = control.dataset.prop;
    if (!id || !isEffectId(id) || !prop) return;
    const value = control.type === "checkbox" ? control.checked : Number(control.value);
    updateEffectSetting(id, prop, value);
    updateEffectPreview(id);
    if (control.type !== "checkbox") {
      const output = control.parentElement?.querySelector("output");
      if (output && typeof value === "number") {
        const unit = prop === "wet" ? "%" : prop === "feedback" ? "" : prop === "ratio" ? ":1" :
          prop === "time" || prop === "decay" || prop === "depth" ? " 秒" :
          prop === "rate" || prop === "frequency" ? " Hz" : prop === "threshold" || prop === "gain" ? " dB" : "%";
        output.value = `${prop === "wet" ? Math.round(value * 100) : value}${unit}`;
      }
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
  document.querySelector<HTMLButtonElement>(`.key[data-note="${note}"]`)?.classList.add("pressed");
  keyHint.textContent = `${noteName(note)} の音が鳴っています`;
}

function stopNote(note: number): void {
  const voice = activeNotes.get(note);
  if (voice === undefined) return;
  engine.noteOff(voice);
  activeNotes.delete(note);
  document.querySelector<HTMLButtonElement>(`.key[data-note="${note}"]`)?.classList.remove("pressed");
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
      audioToggle.querySelector(".button-icon")!.textContent = "▶";
      audioToggle.querySelector("span:last-child")!.textContent = "音の準備をする";
      audioStatus.textContent = "音を止めました。またいつでも準備できます。";
      keyHint.textContent = "音の準備をしたら、鍵盤を押してね";
    } else {
      await engine.start();
      const graphReady = rebuildEffectsGraph();
      audioToggle.setAttribute("aria-pressed", "true");
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

document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    const view = tab.dataset.tab;
    document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((other) => {
      const active = other === tab;
      other.classList.toggle("active", active);
      if (active) other.setAttribute("aria-current", "page");
      else other.removeAttribute("aria-current");
    });
    document.querySelector<HTMLElement>("#synth-view")!.hidden = view !== "synth";
    document.querySelector<HTMLElement>("#effects-view")!.hidden = view !== "effects";
  });
});

function isEffectEnabled(id: EffectId): boolean {
  return effectSettings[id].enabled;
}

function effectOutput(prop: string, value: number): string {
  if (prop === "wet") return `${Math.round(value * 100)}%`;
  if (prop === "time" || prop === "decay" || prop === "depth") return `${value} 秒`;
  if (prop === "rate" || prop === "frequency") return `${value} Hz`;
  if (prop === "threshold" || prop === "gain") return `${value} dB`;
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
  document.querySelectorAll<HTMLInputElement>("[data-envelope]").forEach((input) => {
    const prop = input.dataset.envelope as EnvelopeControl;
    settings.envelope[prop] = normalizeEnvelopeControl(
      prop,
      prop === "sustain" ? settings.envelope[prop] * 100 : settings.envelope[prop]
    );
    input.value = formatEnvelopeControl(prop, settings.envelope[prop]);
  });
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-lfo]").forEach((control) => {
    const key = control.dataset.lfo as "pitchLfo" | "volumeLfo";
    const prop = control.dataset.prop as "enabled" | "waveform" | "frequency" | "depth";
    const lfo = settings[key];
    if (prop === "enabled" && control instanceof HTMLInputElement) control.checked = lfo.enabled;
    else control.value = String(prop === "waveform" ? lfo.waveform : prop === "frequency" ? lfoFrequencyToSlider(lfo.frequency) : lfo.depth);
    if (prop === "frequency" || prop === "depth") {
      const output = control.parentElement?.querySelector("output");
      if (output) output.value = prop === "frequency" ? `${lfo.frequency.toFixed(lfo.frequency < 10 ? 1 : 0)} Hz${lfo.frequency > 20 ? " · 音声レート" : ""}` : `${lfo.depth}${key === "pitchLfo" ? "¢" : ""}`;
    }
    if (prop === "waveform") {
      const path = document.querySelector<SVGPathElement>(`#${key}-wave-visual`);
      if (path) path.setAttribute("d", waveformPath(lfo.waveform));
    }
  });
  document.querySelectorAll<HTMLInputElement>("[data-effect]").forEach((control) => {
    const id = control.dataset.effect;
    const prop = control.dataset.prop;
    if (!id || !isEffectId(id) || !prop) return;
    if (control.type === "checkbox") control.checked = isEffectEnabled(id);
    else {
      const value = effectValue(id, prop);
      control.value = String(value);
      const output = control.parentElement?.querySelector("output");
      if (output) output.value = effectOutput(prop, value);
    }
    updateEffectPreview(id);
  });
  drawEnvelope();
  drawRouting();
}

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

midiInput.addEventListener("change", async () => {
  const file = midiInput.files?.[0];
  if (!file) return;
  if (!/\.(mid|midi)$/i.test(file.name)) {
    stopMidiTransport(true);
    loadedMidi = null;
    midiPlayButton.disabled = true;
    midiStopButton.disabled = true;
    midiStatus.textContent = "拡張子が .mid または .midi のファイルを選んでください。";
    midiInput.value = "";
    return;
  }
  stopMidiTransport(true);
  midiPlayButton.disabled = true;
  try {
    loadedMidi = parseMidiFile(await file.arrayBuffer(), file.name);
    midiStatus.textContent = loadedMidi.notes.length
      ? `${loadedMidi.fileName} · ${loadedMidi.notes.length.toLocaleString()} 音 · ${loadedMidi.trackCount} トラック · ${Math.floor(loadedMidi.duration / 60)}:${String(Math.floor(loadedMidi.duration % 60)).padStart(2, "0")}`
      : "このMIDIファイルに再生できるノートがありません。";
    midiProgress.max = loadedMidi.duration;
    midiProgress.value = 0;
    midiPlayButton.disabled = loadedMidi.notes.length === 0;
    midiStopButton.disabled = loadedMidi.notes.length === 0;
  } catch (error) {
    loadedMidi = null;
    midiInput.value = "";
    midiStatus.textContent = error instanceof Error ? error.message : "MIDIファイルを読み込めませんでした。";
    midiStopButton.disabled = true;
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
  } catch (error) {
    midiStatus.textContent = error instanceof Error ? error.message : "再生を開始できませんでした。";
  }
});

midiStopButton.addEventListener("click", () => {
  stopMidiTransport(true);
  if (loadedMidi) midiStatus.textContent = `${loadedMidi.fileName} を停止しました。`;
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
    ? { tagName: event.target.tagName, isContentEditable: event.target.isContentEditable }
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
  const update = () => {
    const index = Number(control.dataset.osc) as 0 | 1;
    const prop = control.dataset.prop;
    const value = control instanceof HTMLInputElement && control.type === "range"
      ? Number(control.value)
      : control.value;
    if (prop === "waveform") settings.oscillators[index].waveform = value as Waveform;
    if (prop === "volume") settings.oscillators[index].volume = clamp(Number(value), 0, 1);
    if (prop === "semitones") settings.oscillators[index].semitones = clamp(Number(value), -24, 24);
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

document.querySelectorAll<HTMLButtonElement>(".step-button").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.target ?? "") as HTMLInputElement | null;
    if (!input) return;
    input.value = String(clamp(Number(input.value) + Number(button.dataset.step), -24, 24));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
});

document.querySelectorAll<HTMLInputElement>("[data-envelope]").forEach((input) => {
  const update = (format: boolean) => {
    const prop = input.dataset.envelope as EnvelopeControl;
    if (input.value.trim() === "") return;
    const raw = Number(input.value);
    if (!Number.isFinite(raw)) return;
    settings.envelope[prop] = normalizeEnvelopeControl(prop, raw);
    if (format) input.value = formatEnvelopeControl(prop, settings.envelope[prop]);
    drawEnvelope();
    applySettings();
  };
  input.addEventListener("input", () => update(false));
  input.addEventListener("change", () => update(true));
});

document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-lfo]").forEach((control) => {
  const update = () => {
    const key = control.dataset.lfo as "pitchLfo" | "volumeLfo";
    const prop = control.dataset.prop as "enabled" | "waveform" | "frequency" | "depth";
    const lfo = settings[key];
    if (prop === "enabled" && control instanceof HTMLInputElement) lfo.enabled = control.checked;
    if (prop === "waveform") lfo.waveform = control.value as typeof lfo.waveform;
    if (prop === "frequency" && control instanceof HTMLInputElement) lfo.frequency = lfoSliderToFrequency(Number(control.value));
    if (prop === "depth") lfo.depth = clamp(Number(control.value), 0, key === "pitchLfo" ? 200 : 0.5);
    const output = control.parentElement?.querySelector("output");
    if (output && prop !== "enabled" && prop !== "waveform") {
      output.value = prop === "frequency" ? `${lfo.frequency.toFixed(lfo.frequency < 10 ? 1 : 0)} Hz${lfo.frequency > 20 ? " · 音声レート" : ""}` : `${lfo.depth}${key === "pitchLfo" ? "¢" : ""}`;
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

const envelopePath = document.querySelector<SVGPathElement>("#envelope-path")!;
const envelopeHandles = {
  attack: document.querySelector<SVGCircleElement>("#handle-attack")!,
  sustain: document.querySelector<SVGCircleElement>("#handle-sustain")!,
  release: document.querySelector<SVGCircleElement>("#handle-release")!
};
function drawEnvelope(): void {
  const { attack, decay, sustain, release } = settings.envelope;
  const scale = 305 / (attack + decay + 0.55 + release);
  const xAttack = 28 + attack * scale;
  const xSustain = xAttack + decay * scale;
  const xOff = xSustain + 0.55 * scale;
  const xEnd = xOff + release * scale;
  const ySustain = 25 + (1 - sustain) * 66;
  envelopePath.setAttribute("d", `M 24 96 L ${xAttack} 25 L ${xSustain} ${ySustain} L ${xOff} ${ySustain} L ${xEnd} 96`);
  envelopeHandles.attack.setAttribute("cx", String(xAttack));
  envelopeHandles.attack.setAttribute("cy", "25");
  envelopeHandles.sustain.setAttribute("cx", String(xSustain));
  envelopeHandles.sustain.setAttribute("cy", String(ySustain));
  envelopeHandles.release.setAttribute("cx", String(xEnd));
  envelopeHandles.release.setAttribute("cy", "96");
  envelopeHandles.attack.setAttribute("aria-valuenow", attack.toFixed(2));
  envelopeHandles.sustain.setAttribute("aria-valuenow", (sustain * 100).toFixed(2));
  envelopeHandles.release.setAttribute("aria-valuenow", release.toFixed(2));
}
drawEnvelope();

let dragHandle: keyof typeof envelopeHandles | null = null;
const envelopeSvg = document.querySelector<SVGSVGElement>("#envelope-svg")!;
function updateEnvelopeFromPointer(event: PointerEvent): void {
  if (!dragHandle) return;
  const bounds = envelopeSvg.getBoundingClientRect();
  const x = (event.clientX - bounds.left) * 400 / bounds.width;
  const y = (event.clientY - bounds.top) * 130 / bounds.height;
  const { attack, decay, release } = settings.envelope;
  const scale = 305 / (attack + decay + 0.55 + release);
  if (dragHandle === "attack") settings.envelope.attack = clamp((x - 28) / scale, 0.01, 5);
  if (dragHandle === "sustain") {
    settings.envelope.decay = clamp((x - 28 - settings.envelope.attack * scale) / scale, 0.01, 5);
    settings.envelope.sustain = clamp(1 - (y - 25) / 66, 0, 1);
  }
  if (dragHandle === "release") {
    const xOff = 28 + settings.envelope.attack * scale + settings.envelope.decay * scale + 0.55 * scale;
    settings.envelope.release = clamp((x - xOff) / scale, 0.01, 5);
  }
  for (const [key, value] of Object.entries(settings.envelope)) {
    const input = document.querySelector<HTMLInputElement>(`[data-envelope="${key}"]`);
    if (input) input.value = formatEnvelopeControl(key as EnvelopeControl, value);
  }
  drawEnvelope();
  applySettings();
}
Object.entries(envelopeHandles).forEach(([name, handle]) => {
  const part = name as keyof typeof envelopeHandles;
  handle.addEventListener("pointerdown", (event) => {
    dragHandle = part;
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
    if (part === "attack") settings.envelope.attack = clamp(settings.envelope.attack + delta, 0.01, 5);
    if (part === "release") settings.envelope.release = clamp(settings.envelope.release + delta, 0.01, 5);
    if (part === "sustain") settings.envelope.sustain = clamp(settings.envelope.sustain - delta, 0, 1);
    const input = document.querySelector<HTMLInputElement>(`[data-envelope="${part}"]`);
    if (input) input.value = formatEnvelopeControl(part, settings.envelope[part]);
    drawEnvelope();
    applySettings();
  });
});
