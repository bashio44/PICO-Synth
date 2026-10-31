export type EffectId = "distortion" | "chorus" | "compressor" | "eq" | "delay" | "reverb";
export type EqFilterType = "peaking" | "notch" | "highpass" | "lowpass";

export const eqFilterTypes: readonly EqFilterType[] = ["peaking", "notch", "highpass", "lowpass"];
export const eqFilterNames: Record<EqFilterType, string> = {
  peaking: "Peak",
  notch: "Notch",
  highpass: "HPF",
  lowpass: "LPF"
};

export interface WetSettings {
  enabled: boolean;
  wet: number;
}

export interface EffectSettingsById {
  distortion: WetSettings & { drive: number; tone: number };
  chorus: WetSettings & { rate: number; depth: number };
  compressor: { enabled: boolean; threshold: number; ratio: number; knee: number; attack: number; release: number };
  eq: WetSettings & { bands: [EqBandSettings, EqBandSettings, EqBandSettings] };
  delay: WetSettings & { time: number; feedback: number };
  reverb: WetSettings & { decay: number; preDelay: number };
}

export interface EqBandSettings {
  enabled: boolean;
  type: EqFilterType;
  frequency: number;
  q: number;
  gain: number;
}

export type EffectConfiguration = {
  [K in EffectId]: EffectSettingsById[K];
};

export interface RoutingEdge {
  from: string;
  to: string;
}

export const effectNames: Record<EffectId, string> = {
  distortion: "ディストーション",
  chorus: "コーラス",
  compressor: "コンプレッサー",
  eq: "EQ（音の明るさ）",
  delay: "ディレイ",
  reverb: "リバーブ"
};

export const effectTerms: Record<EffectId, string> = {
  distortion: "Distortion",
  chorus: "Chorus",
  compressor: "Compressor",
  eq: "Equalizer",
  delay: "Delay",
  reverb: "Reverb"
};

export const defaultEffects: EffectConfiguration = {
  distortion: { enabled: false, wet: 0.35, drive: 28, tone: 12_000 },
  chorus: { enabled: false, wet: 0.3, rate: 0.8, depth: 0.012 },
  compressor: { enabled: false, threshold: -24, ratio: 4, knee: 30, attack: 0.003, release: 0.25 },
  eq: {
    enabled: false,
    wet: 1,
    bands: [
      { enabled: true, type: "peaking", frequency: 1200, q: 0.8, gain: 0 },
      { enabled: false, type: "peaking", frequency: 4000, q: 1, gain: 0 },
      { enabled: false, type: "peaking", frequency: 10_000, q: 1, gain: 0 }
    ]
  },
  delay: { enabled: false, wet: 0.25, time: 0.28, feedback: 0.32 },
  reverb: { enabled: false, wet: 0.2, decay: 1.8, preDelay: 0.02 }
};

export const defaultRouting: RoutingEdge[] = [
  { from: "input", to: "distortion" },
  { from: "distortion", to: "chorus" },
  { from: "chorus", to: "compressor" },
  { from: "compressor", to: "eq" },
  { from: "eq", to: "delay" },
  { from: "delay", to: "reverb" },
  { from: "reverb", to: "output" }
];

export const routingNodes = ["input", "distortion", "chorus", "compressor", "eq", "delay", "reverb", "send", "output"] as const;
export type RoutingNodeId = (typeof routingNodes)[number];

export function validateEffects(effects: EffectConfiguration): string | null {
  if (!effects || typeof effects !== "object") return "エフェクト設定が見つかりません。";
  const rules: Record<EffectId, Array<[string, number, number]>> = {
    distortion: [["wet", 0, 1], ["drive", 0, 100], ["tone", 200, 20_000]],
    chorus: [["wet", 0, 1], ["rate", 0.1, 10], ["depth", 0.001, 0.05]],
    compressor: [["threshold", -100, 0], ["ratio", 1, 20], ["knee", 0, 40], ["attack", 0.001, 1], ["release", 0.01, 1]],
    eq: [["wet", 0, 1]],
    delay: [["wet", 0, 1], ["time", 0.01, 2], ["feedback", 0, 0.8]],
    reverb: [["wet", 0, 1], ["decay", 0.1, 5], ["preDelay", 0, 0.2]]
  };
  for (const [id, fields] of Object.entries(rules) as [EffectId, Array<[string, number, number]>][]) {
    const config = effects[id] as Record<string, unknown> | undefined;
    if (!config || typeof config.enabled !== "boolean") return `${effectNames[id]}のオン・オフ設定が正しくありません。`;
    for (const [name, min, max] of fields) {
      const value = config[name];
      if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
        return `${effectNames[id]}の「${name}」は${min}〜${max}の範囲で指定してください。`;
      }
    }
  }
  const bands = (effects?.eq as unknown as Record<string, unknown> | undefined)?.bands;
  if (!Array.isArray(bands) || bands.length !== 3) return "EQには3つのバンド設定が必要です。";
  for (const [index, value] of bands.entries()) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return `EQバンド${index + 1}の設定が正しくありません。`;
    }
    const band = value as Record<string, unknown>;
    if (typeof band.enabled !== "boolean") return `EQバンド${index + 1}のオン・オフ設定が正しくありません。`;
    if (typeof band.type !== "string" || !eqFilterTypes.includes(band.type as EqFilterType)) {
      return `EQバンド${index + 1}のフィルター形式が正しくありません。`;
    }
    for (const [name, min, max] of [["frequency", 20, 20_000], ["q", 0.1, 18], ["gain", -24, 24]] as const) {
      const field = band[name];
      if (typeof field !== "number" || !Number.isFinite(field) || field < min || field > max) {
        return `EQバンド${index + 1}の「${name}」は${min}〜${max}の範囲で指定してください。`;
      }
    }
  }
  return null;
}

export function validateRouting(edges: RoutingEdge[]): string | null {
  if (!Array.isArray(edges) || edges.length > 32) return "配線の数が正しくありません。";
  const known = new Set<string>(routingNodes);
  const adjacency = new Map<string, string[]>();
  const unique = new Set<string>();

  for (const edge of edges) {
    if (!edge || typeof edge.from !== "string" || typeof edge.to !== "string" ||
        !known.has(edge.from) || !known.has(edge.to)) {
      return "接続先が見つかりません。配線の始点と終点を確認してください。";
    }
    if (edge.from === "output" || edge.to === "input") return "音の出口から入口へ戻す配線はできません。";
    if (edge.from === edge.to) return "同じ場所につなぐことはできません。";
    const key = `${edge.from}->${edge.to}`;
    if (unique.has(key)) return "同じ配線が重複しています。";
    unique.add(key);
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const hasCycle = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const next of adjacency.get(node) ?? []) if (hasCycle(next)) return true;
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  for (const node of routingNodes) {
    if (hasCycle(node)) return "この配線は音が同じ場所を回り続けるため使えません。ディレイ内部のひびきは安全な範囲で使えます。";
  }

  const reachable = new Set<string>();
  const visit = (node: string) => {
    if (reachable.has(node)) return;
    reachable.add(node);
    for (const next of adjacency.get(node) ?? []) visit(next);
  };
  visit("input");
  if (!reachable.has("output")) return "音の入口から出口までの道すじをつないでください。";
  return null;
}
