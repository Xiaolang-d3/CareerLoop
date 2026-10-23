import { describe, expect, it } from "vitest";
import { efficientFrontier, makeAxis, placeLabels, type ChartPoint } from "./benchmark-chart";
import type { HomeModelBenchmark } from "./types";

const point = (id: string, cost: number, intelligence: number, speed = cost): ChartPoint => ({
  model: { id, name: `Model ${id} (high)`, task_cost: cost, intelligence, tokens_per_second: speed } as HomeModelBenchmark,
  x: 300, y: 200,
});

describe("benchmark chart scales and efficiency boundary", () => {
  it("spreads orders of magnitude equally and keeps free models separate from log zero", () => {
    const axis = makeAxis([0, 0.01, 0.1, 1, 10], true);
    expect(axis.position(0)).toBe(0);
    expect(axis.position(0.01)).toBeGreaterThan(0);
    expect(axis.position(0.1) - axis.position(0.01)).toBeCloseTo(axis.position(1) - axis.position(0.1));
    expect(axis.position(10)).toBe(1);
    expect(axis.ticks).toContain(0);
    expect(makeAxis([0, 0], true).position(0)).toBe(0);
    expect(makeAxis([4, 8], false).position(4)).toBe(0.5);
  });

  it("excludes dominated models and duplicates from the boundary, with the correct speed direction", () => {
    const rows = [point("a", 1, 20, 100), point("b", 1, 10, 10), point("c", 2, 19, 200), point("d", 3, 30, 90), point("e", 3, 30, 90)];
    expect(efficientFrontier(rows, "task_cost").map(p => p.model.id)).toEqual(["a", "d"]);
    expect(efficientFrontier(rows, "tokens_per_second").map(p => p.model.id)).toEqual(["c", "a", "d"]);
    expect(rows).toHaveLength(5); // Boundary calculation must not filter the data.
  });

  it("keeps labels apart in a dense cluster and always prioritizes the active model", () => {
    const rows = Array.from({ length: 25 }, (_, i) => point(String(i), i + 1, 30 + i));
    const labels = placeLabels(rows, efficientFrontier(rows, "task_cost"), "0");
    expect(labels[0].model.id).toBe("0");
    expect(labels.length).toBeGreaterThan(1);
    for (let i = 0; i < labels.length; i++) {
      for (const other of labels.slice(i + 1)) {
        const label = labels[i];
        expect(label.left + label.width <= other.left || other.left + other.width <= label.left
          || label.top + label.height <= other.top || other.top + other.height <= label.top).toBe(true);
      }
    }
  });
});
