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
  distortion: "歪み方",
  chorus: "音の広がり",
  compressor: "音量の圧縮",
  eq: "周波数ごとの音量",
  delay: "やまびこの減衰",
  reverb: "ひびきの減衰"
};

function graphPath(sample: (position: number) => number, samples = 50): string {
  return Array.from({ length: samples + 1 }, (_, index) => {
    const position = index / samples;
    return `${index === 0 ? "M" : "L"} ${(12 + position * 196).toFixed(1)} ${(57 - sample(position) * 45).toFixed(1)}`;
  }).join(" ");
}

function waveformEffectPath(phaseOffset: number, depth: number, rate: number, amplitude: number): string {
  return graphPath((position) => {
    const cycles = Math.min(8, Math.max(0.1, rate));
    const phase = position * Math.PI * 2 * cycles + phaseOffset + Math.sin(position * Math.PI * 2 * cycles) * depth;
    return 0.5 + Math.sin(phase) * amplitude;
  });
}

function effectCurve(id: EffectId, effects: EffectConfiguration): string {
  switch (id) {
    case "distortion": {
      const drive = effects.distortion.drive / 100 * 18 + 1;
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
      const normalizedDepth = depth / 0.05;
      return `${waveformEffectPath(0, normalizedDepth * 0.14, rate, 0.38)} ${waveformEffectPath(0.5 + normalizedDepth * 0.6, normalizedDepth * 0.14, rate, 0.38 * wet)}`;
    }
    case "compressor": {
      const threshold = effects.compressor.threshold;
      const ratio = effects.compressor.ratio;
      return graphPath((position) => {
        const inputDb = -60 + position * 60;
        const outputDb = inputDb > threshold ? threshold + (inputDb - threshold) / ratio : inputDb;
        return (outputDb + 60) / 60;
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
      const feedback = effects.delay.feedback;
      const wet = effects.delay.wet;
      const spacing = 10 + Math.log(effects.delay.time / 0.01 + 1) / Math.log(201) * 23;
      return Array.from({ length: 7 }, (_, index) => {
        const amplitude = (index === 0 ? 1 - wet * 0.35 : feedback ** index * wet);
        const x = 12 + index * spacing;
        const height = amplitude * 42;
        return `M ${x} 57 L ${x} ${(57 - height).toFixed(1)}`;
      }).join(" ");
    }
    case "reverb": {
      const { decay, wet } = effects.reverb;
      return graphPath((position) => 0.08 + wet * Math.exp(-position * 5 / decay) * 0.82);
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
      ? '<text x="12" y="74">すぐ</text><text x="184" y="74">あと</text>'
      : '<text x="12" y="74">入力</text><text x="183" y="74">出力</text>';
  const paths = effectCurve(id, effects);
  const chorusPaths = id === "chorus" ? paths.split(/ (?=M)/) : [paths];
  const eqMarker = id === "eq" ? (() => {
    const center = 12 + Math.log(effects.eq.frequency / 20) / Math.log(20_000 / 20) * 196;
    const width = Math.max(4, Math.min(42, 0.12 / effects.eq.q * 196));
    return `<path class="effect-eq-band" d="M ${(center - width).toFixed(1)} 57 Q ${center.toFixed(1)} 52 ${(center + width).toFixed(1)} 57" /><path class="effect-eq-center" d="M ${center.toFixed(1)} 10 V59" />`;
  })() : "";
  const curveOpacity = id === "eq" ? 0.25 + effects.eq.wet * 0.75 : 1;
  return `<svg class="effect-visual-svg ${state}" viewBox="0 0 220 80" role="img" aria-label="${effectLabels[id]}を表示するグラフ">
    <path class="effect-grid-line" d="M12 12 H208 M12 34 H208 M12 57 H208 M61 10 V59 M110 10 V59 M159 10 V59" />
    ${baseline}
    ${eqMarker}
    ${chorusPaths.map((path, index) => `<path class="effect-curve ${index > 0 ? "effect-curve-secondary" : ""}" style="opacity:${curveOpacity}" d="${path}" />`).join("")}
    ${id === "delay" ? Array.from({ length: 7 }, (_, index) => {
      const spacing = 10 + Math.log(effects.delay.time / 0.01 + 1) / Math.log(201) * 23;
      const amplitude = index === 0 ? 1 - effects.delay.wet * 0.35 : effects.delay.feedback ** index * effects.delay.wet;
      return `<circle class="effect-echo-dot" cx="${12 + index * spacing}" cy="${57 - amplitude * 42}" r="${Math.max(1.5, 4 - index * 0.3)}" />`;
    }).join("") : ""}
    ${axisLabels}
  </svg>`;
}
