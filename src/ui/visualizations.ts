import type { Waveform } from "../model/config";
import type { EffectConfiguration, EffectId } from "../model/effects";

const waveformSamples = 72;

export function waveformPath(waveform: Waveform): string {
  const samples = waveform === "noise" ? 48 : waveformSamples;
  const points = Array.from({ length: samples + 1 }, (_, index) => {
    const phase = (index / samples * 3) % 1;
    let amplitude: number;
    switch (waveform) {
      case "sine":
        amplitude = Math.sin(phase * Math.PI * 2);
        break;
      case "square":
        amplitude = phase < 0.5 ? 1 : -1;
        break;
      case "sawtooth":
        amplitude = phase * 2 - 1;
        break;
      case "triangle":
        amplitude = 1 - 4 * Math.abs(phase - 0.5);
        break;
      case "noise": {
        const seed = Math.sin(index * 127.1 + 311.7) * 43_758.5453;
        amplitude = (seed - Math.floor(seed)) * 2 - 1;
        break;
      }
    }
    return `${(index / samples * 200).toFixed(1)},${(24 - amplitude * 17).toFixed(1)}`;
  });
  return `M ${points.join(" L ")}`;
}

const effectLabels: Record<EffectId, string> = {
  distortion: "入力レベルに対する出力レベル（歪みの伝達特性）",
  chorus: "入力信号とコーラス処理後の時間波形",
  compressor: "入力レベルに対する出力レベル（圧縮特性）",
  eq: "周波数ごとのゲイン",
  delay: "時間ごとの直接音とディレイ反復の音量",
  reverb: "時間ごとのリバーブ減衰"
};

function graphPath(sample: (position: number) => number, samples = 100): string {
  return Array.from({ length: samples + 1 }, (_, index) => {
    const position = index / samples;
    return `${index === 0 ? "M" : "L"} ${(12 + position * 196).toFixed(2)} ${(57 - sample(position) * 45).toFixed(2)}`;
  }).join(" ");
}

function effectCurve(id: EffectId, effects: EffectConfiguration): string {
  switch (id) {
    case "distortion": {
      const drive = effects.distortion.drive * 3 + 1;
      const normalizer = Math.tanh(drive);
      const wet = effects.distortion.wet;
      return graphPath((position) => {
        const input = position * 2 - 1;
        const processed = Math.tanh(input * drive) / normalizer;
        return ((1 - wet) * input + wet * processed + 1) / 2;
      });
    }
    case "chorus": {
      const { depth, rate, wet } = effects.chorus;
      const input = graphPath((position) => 0.5 + Math.sin(position * Math.PI * 8) * 0.36);
      const processed = graphPath((position) => {
        const time = position;
        const phase = time * Math.PI * 8;
        const delay = 0.05 + depth * Math.sin(time * Math.PI * 2 * rate);
        const drySample = Math.sin(phase);
        const delayedSample = Math.sin(phase - Math.PI * 8 * delay);
        return 0.5 + ((1 - wet) * drySample + wet * delayedSample) * 0.36;
      });
      return `${input} ${processed}`;
    }
    case "compressor": {
      const threshold = effects.compressor.threshold;
      const ratio = effects.compressor.ratio;
      const knee = effects.compressor.knee;
      return graphPath((position) => {
        const inputDb = -60 + position * 60;
        const lower = threshold - knee / 2;
        const upper = threshold + knee / 2;
        const outputDb = knee > 0 && inputDb > lower && inputDb < upper
          ? inputDb + (1 / ratio - 1) * (inputDb - lower) ** 2 / (2 * knee)
          : inputDb >= upper
            ? threshold + (inputDb - threshold) / ratio
            : inputDb;
        return Math.max(0, Math.min(1, (outputDb + 60) / 60));
      });
    }
    case "eq": {
      const { frequency, q, gain, wet } = effects.eq;
      const center = Math.log(frequency / 20) / Math.log(20_000 / 20);
      const width = Math.max(0.025, 0.22 / q);
      return graphPath((position) => {
        const response = gain * wet * Math.exp(-0.5 * ((position - center) / width) ** 2);
        return Math.max(0, Math.min(1, 0.5 + response / 48));
      });
    }
    case "delay": {
      return Array.from({ length: 7 }, (_, index) => {
        const amplitude = index === 0 ? 1 - effects.delay.wet : effects.delay.feedback ** (index - 1) * effects.delay.wet;
        const x = 12 + Math.min(1, index * effects.delay.time / 12) * 196;
        const height = amplitude * 42;
        return `M ${x} 57 L ${x} ${(57 - height).toFixed(1)}`;
      }).join(" ");
    }
    case "reverb": {
      const { decay, preDelay, wet } = effects.reverb;
      const delayPosition = preDelay / 5.2;
      const decayPosition = decay / 5.2;
      return graphPath((position) => {
        if (position < delayPosition) return 0.5;
        const progress = Math.min(1, (position - delayPosition) / decayPosition);
        return 0.5 + wet * (1 - progress) ** 2 * 0.42;
      });
    }
  }
}

export function effectPreviewSvg(id: EffectId, effects: EffectConfiguration): string {
  const config = effects[id];
  const state = config.enabled ? "on" : "off";
  const baseline = id === "eq"
    ? '<path class="effect-zero-line" d="M12 34 H208" />'
    : id === "compressor" || id === "distortion"
      ? '<path class="effect-zero-line" d="M12 57 L208 12" />'
      : '<path class="effect-zero-line" d="M12 34 H208" />';
  const axisLabels = id === "eq"
    ? '<text x="12" y="74">低い音</text><text x="174" y="74">高い音</text>'
    : id === "delay"
      ? '<text x="12" y="74">0 秒</text><text x="184" y="74">12 秒</text>'
      : id === "chorus" || id === "reverb"
        ? '<text x="12" y="74">時間</text><text x="183" y="74">振幅</text>'
        : '<text x="12" y="74">入力</text><text x="183" y="74">出力</text>';
  const paths = effectCurve(id, effects);
  const chorusPaths = id === "chorus" ? paths.split(/ (?=M)/) : [paths];
  const eqMarker = id === "eq" ? (() => {
    const center = 12 + Math.log(effects.eq.frequency / 20) / Math.log(20_000 / 20) * 196;
    const width = Math.max(4, Math.min(42, 0.12 / effects.eq.q * 196));
    return `<path class="effect-eq-band" d="M ${(center - width).toFixed(1)} 57 Q ${center.toFixed(1)} 52 ${(center + width).toFixed(1)} 57" /><path class="effect-eq-center" d="M ${center.toFixed(1)} 10 V59" />`;
  })() : "";
  const effectAnnotation = id === "distortion"
    ? `Tone ${effects.distortion.tone} Hz`
    : id === "compressor"
      ? `A ${effects.compressor.attack}s · R ${effects.compressor.release}s`
      : "";
  const curveOpacity = id === "eq" ? 0.25 + effects.eq.wet * 0.75 : 1;
  return `<svg class="effect-visual-svg ${state}" viewBox="0 0 220 80" role="img" aria-label="${effectLabels[id]}を表示するグラフ">
    <path class="effect-grid-line" d="M12 12 H208 M12 34 H208 M12 57 H208 M61 10 V59 M110 10 V59 M159 10 V59" />
    ${baseline}
    ${eqMarker}
    ${effectAnnotation ? `<text class="effect-annotation" x="14" y="9">${effectAnnotation}</text>` : ""}
    ${chorusPaths.map((path, index) => `<path class="effect-curve ${index > 0 ? "effect-curve-secondary" : ""}" style="opacity:${curveOpacity}" d="${path}" />`).join("")}
    ${id === "delay" ? Array.from({ length: 7 }, (_, index) => {
      const amplitude = index === 0 ? 1 - effects.delay.wet : effects.delay.feedback ** (index - 1) * effects.delay.wet;
      const x = 12 + Math.min(1, index * effects.delay.time / 12) * 196;
      return `<circle class="effect-echo-dot" cx="${x}" cy="${57 - amplitude * 42}" r="${Math.max(1.5, 4 - index * 0.3)}" />`;
    }).join("") : ""}
    ${id === "reverb" ? `<circle class="effect-echo-dot" cx="12" cy="${57 - (1 - effects.reverb.wet) * 42}" r="3.5" />` : ""}
    ${axisLabels}
  </svg>`;
}
