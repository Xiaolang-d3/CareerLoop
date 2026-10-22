import type { HomeModelBenchmark } from "./types";

export type ChartMetric = "task_cost" | "tokens_per_second";
export const CHART = { width: 1100, height: 590, left: 70, right: 1050, top: 60, bottom: 500 };
export type ChartPoint = { model: HomeModelBenchmark; x: number; y: number };
export type ChartLabel = ChartPoint & { left: number; top: number; width: number; height: number; lines: string[] };

export function creatorColor(creator: string) {
  const palette: Record<string, string> = {
    OpenAI: "#202624", Anthropic: "#ba806c", Google: "#509b59", Meta: "#3580df",
    DeepSeek: "#4258d6", Alibaba: "#e97a2c", Xiaomi: "#ef792e", "Z AI": "#307ad5",
    Kimi: "#445bc5", MiniMax: "#d44b78", StepFun: "#25aa9e", Mistral: "#df4b32",
    SpaceXAI: "#8270bf", xAI: "#8270bf", NVIDIA: "#80a934",
  };
  if (palette[creator]) return palette[creator];
  let hash = 0;
  for (const letter of creator) hash = (hash * 31 + letter.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 53% 43%)`;
}

export function makeAxis(values: number[], logarithmic: boolean) {
  const positive = values.filter(value => Number.isFinite(value) && value > 0);
  const maximum = Math.max(0, ...positive);
  if (!logarithmic || !positive.length) {
    const max = maximum || 1;
    return { ticks: Array.from({ length: 5 }, (_, i) => max * i / 4), position: (value: number) => value / max };
  }
  const min = Math.min(...positive);
  const low = Math.floor(Math.log10(min));
  const high = Math.max(low + 1, Math.ceil(Math.log10(maximum)));
  const hasZero = values.includes(0);
  const offset = hasZero ? 0.045 : 0;
  const ticks: number[] = hasZero ? [0] : [];
  const step = high - low > 4 ? [1] : [1, 2, 5];
  for (let exponent = low; exponent <= high; exponent++) {
    for (const factor of step) {
      const value = factor * 10 ** exponent;
      if (value <= 10 ** high) ticks.push(value);
    }
  }
  return { ticks, position: (value: number) => value === 0 ? 0 : offset + (1 - offset) * (Math.log10(value) - low) / (high - low) };
}

// A frontier point offers a higher score than every cheaper (or faster) point.
// Equal coordinates share a frontier vertex, while every model remains plotted.
export function efficientFrontier(points: ChartPoint[], metric: ChartMetric) {
  const sorted = [...points].sort((a, b) => (metric === "task_cost" ? a.model[metric]! - b.model[metric]! : b.model[metric]! - a.model[metric]!)
    || b.model.intelligence! - a.model.intelligence! || a.model.id.localeCompare(b.model.id));
  let best = -Infinity;
  return sorted.filter(point => {
    if (point.model.intelligence! <= best) return false;
    best = point.model.intelligence!;
    return true;
  });
}

function labelLines(name: string) {
  const words = name.replace(/,?\s*Default Fallback/gi, "").split(/\s+/);
  const lines = [""];
  for (const word of words) {
    if ((lines[lines.length - 1] + " " + word).trim().length > 28 && lines.length < 2) lines.push(word);
    else lines[lines.length - 1] = (lines[lines.length - 1] + " " + word).trim();
  }
  return lines.map(line => line.length > 32 ? line.slice(0, 30) + "…" : line);
}

export function placeLabels(points: ChartPoint[], frontier: ChartPoint[], activeId?: string | null, frame = CHART, limit = 10) {
  const strongest = [...points].sort((a, b) => b.model.intelligence! - a.model.intelligence! || a.model.id.localeCompare(b.model.id));
  const active = points.find(point => point.model.id === activeId);
  // Annotate frontier endpoints and high-scoring creators first so that
  // near-identical reasoning variants cannot consume every available label.
  // This only selects annotations: all configurations stay in the plot.
  const frontierLabels = frontier.length ? [frontier[frontier.length - 1], frontier[0]] : [];
  const creators = new Set<string>();
  const creatorLeaders = strongest.filter(point => {
    if (creators.has(point.model.creator)) return false;
    creators.add(point.model.creator);
    return true;
  });
  const candidates = points.length <= limit ? strongest : frontierLabels.concat(creatorLeaders, strongest.slice(0, 6));
  const unique = new Map<string, ChartPoint>();
  for (const point of [...(active ? [active] : []), ...candidates]) unique.set(point.model.id, point);
  const labels: ChartLabel[] = [];
  for (const point of [...unique.values()].slice(0, limit)) {
    const lines = labelLines(point.model.name);
    const width = Math.max(...lines.map(line => line.length)) * 6.2 + 12;
    const height = lines.length * 16 + 8;
    let chosen: ChartLabel | null = null;
    for (const dy of [-height - 7, 9, -height - 28, 30, -height - 52, 54, -height - 78, 80]) {
      for (const dx of [10, -width - 10, -width / 2]) {
        const left = Math.max(frame.left, Math.min(frame.right - width, point.x + dx));
        const top = Math.max(24, Math.min(frame.bottom - height, point.y + dy));
        const box = { left, top, width, height };
        const overlaps = labels.some(label => box.left < label.left + label.width + 6 && box.left + width + 6 > label.left
          && box.top < label.top + label.height + 4 && box.top + height + 4 > label.top);
        if (!overlaps) { chosen = { ...point, ...box, lines }; break; }
      }
      if (chosen) break;
    }
    // Crowded labels are omitted rather than drawn on top of another name.
    if (chosen) labels.push(chosen);
  }
  return labels;
}
