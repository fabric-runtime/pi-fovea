// Basins: conductance-cut feature regions for anchor-sparse repos.

import { describe, expect, it } from "vitest";
import { detectBasins } from "../src/core/basins.js";

type Adj = Map<number, Array<{ to: number; kind: string; w: number }>>;

const build = (
  edges: Array<[number, number, number]>,
  n: number,
): { adjacency: Adj; cond: Float64Array } => {
  const adjacency: Adj = new Map();
  const cond = new Float64Array(n);
  for (const [a, b, w] of edges) {
    (adjacency.get(a) ?? adjacency.set(a, []).get(a)!).push({ to: b, kind: "join", w });
    (adjacency.get(b) ?? adjacency.set(b, []).get(b)!).push({ to: a, kind: "join", w });
    cond[a]! += w;
    cond[b]! += w;
  }
  return { adjacency, cond };
};

describe("detectBasins", () => {
  it("separates two dense clusters joined by a weak bridge", () => {
    const edges: Array<[number, number, number]> = [];
    for (const grp of [
      [0, 1, 2, 3, 4],
      [5, 6, 7, 8, 9],
    ]) {
      for (const i of grp) for (const j of grp) if (i < j) edges.push([i, j, 1]);
    }
    edges.push([4, 5, 0.05]); // weak bridge
    const { adjacency, cond } = build(edges, 10);
    const basins = detectBasins(adjacency, cond, 10);
    expect(basins.length).toBeGreaterThanOrEqual(2);
    for (const b of basins) {
      const s = new Set(b.members);
      const a = [0, 1, 2, 3, 4].filter((i) => s.has(i)).length;
      const b2 = [5, 6, 7, 8, 9].filter((i) => s.has(i)).length;
      expect(Math.min(a, b2)).toBeLessThanOrEqual(1); // no cross-cluster smear
    }
  });

  it("pure star topology yields no basin (no community)", () => {
    const edges: Array<[number, number, number]> = [1, 2, 3, 4, 5].map(
      (j) => [0, j, 1] as [number, number, number],
    );
    const { adjacency, cond } = build(edges, 6);
    expect(detectBasins(adjacency, cond, 6)).toEqual([]);
  });

  it("eligibility filter excludes file/anchor-style nodes", () => {
    const edges: Array<[number, number, number]> = [];
    for (const grp of [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
    ]) {
      for (const i of grp) for (const j of grp) if (i < j) edges.push([i, j, 1]);
    }
    const { adjacency, cond } = build(edges, 8);
    const onlyFirstCluster = (i: number): boolean => i < 4;
    const basins = detectBasins(adjacency, cond, 8, onlyFirstCluster);
    expect(basins).toHaveLength(1);
    expect(Math.max(...basins[0]!.members)).toBeLessThan(4);
  });

  it("keeps excluded nodes out of scoped region membership", () => {
    const edges: Array<[number, number, number]> = [];
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) edges.push([i, j, 1]);
      for (let j = 4; j < 8; j++) edges.push([i, j, 0.05]);
    }
    const { adjacency, cond } = build(edges, 8);
    const production = (i: number): boolean => i < 4;
    const basins = detectBasins(adjacency, cond, 8, production, production);
    expect(basins).toHaveLength(1);
    expect(basins[0]!.members).toHaveLength(4);
    expect(basins[0]!.members.every(production)).toBe(true);
  });
});
