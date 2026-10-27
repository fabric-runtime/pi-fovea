// Implicit features for anchor-sparse repos. When a repo declares no routes
// (CLIs, libraries, kernels), the silhouette would collapse to directory
// buckets. Basins instead grow greedy high-internal-conductance regions
// around self-consistent seeds — regions that hang together under diffusion.
//
// Algorithm: score seeds by (conductance × local triangle density); walk
// outward by best conductance-to-membership ratio until the cut exceeds the
// basin's internal average (conductance cut). Bounded, deterministic.

export interface Basin {
  seed: number;
  members: number[];
  mass: number;
}

const MAX_BASINS = 12;
const MAX_BASIN_SIZE = 64;
const MIN_BASIN_SIZE = 4;

// eligible marks nodes that may seed a basin (symbols, not files/anchors: a
// file's contains-star has ~zero triangle density and yields useless seeds).
// include optionally constrains every member, for operation-specific views
// such as production-first sketching without changing the underlying graph.
export const detectBasins = (
  adjacency: Map<number, Array<{ to: number; kind: string; w: number }>>,
  conductance: Float64Array,
  n: number,
  eligible?: (i: number) => boolean,
  include?: (i: number) => boolean,
): Basin[] => {
  // Triangle density: fraction of a node's neighbors that are co-neighbors.
  // Cheap O(deg^2) sampling with degree cap — hubs are star points anyway.
  const triScore = (i: number): number => {
    const nbrs = (adjacency.get(i) ?? []).slice(0, 12).map((e) => e.to);
    if (nbrs.length < 2) return 0;
    const sets = nbrs.map((j) => new Set((adjacency.get(j) ?? []).map((e) => e.to)));
    let linked = 0;
    let pairCount = 0;
    for (let a = 0; a < nbrs.length; a++) {
      for (let b2 = a + 1; b2 < nbrs.length; b2++) {
        pairCount++;
        if (sets[a]!.has(nbrs[b2]!) || sets[b2]!.has(nbrs[a]!)) linked++;
      }
    }
    return pairCount ? linked / pairCount : 0;
  };

  // Candidate seeds: meaningful conductance and a real neighborhood.
  const candidates: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const deg = (adjacency.get(i) ?? []).length;
    if (deg >= 2 && (conductance[i] ?? 0) > 0 && (!eligible || eligible(i))) {
      const tri = triScore(i);
      if (tri >= 0.08 || deg >= 6)
        candidates.push([i, (conductance[i] ?? 0) * (0.25 + 0.75 * tri) + deg * 0.02]);
    }
  }
  candidates.sort((a, b2) => b2[1] - a[1]);

  const claimed = new Set<number>();
  const basins: Basin[] = [];
  for (const [seed] of candidates) {
    if (basins.length >= MAX_BASINS) break;
    if (claimed.has(seed)) continue;
    // Grow: repeatedly attach the boundary edge with the best ratio of
    // weight-into-basin to weight-total. Stop when the cut dominates.
    const members = new Set<number>([seed]);
    const order: number[] = [seed];
    let internal = 0;
    const boundary = new Map<number, number>();
    for (const e of adjacency.get(seed) ?? []) {
      if (!include || include(e.to)) boundary.set(e.to, (boundary.get(e.to) ?? 0) + e.w);
    }
    while (order.length < MAX_BASIN_SIZE && boundary.size) {
      let best = -1;
      let bestRatio = -1;
      for (const [j, inW] of boundary) {
        if (claimed.has(j) || members.has(j) || (include && !include(j))) continue;
        const total = [...(adjacency.get(j) ?? [])].reduce((s, e) => s + e.w, 0);
        const ratio = total > 0 ? inW / total : 0;
        if (ratio > bestRatio) {
          bestRatio = ratio;
          best = j;
        }
      }
      // Ratio = share of the candidate's total weight pointing into the
      // basin. Small tight groups admit low first-step ratios, so the floor
      // is permissive; the cut-domination rule below is the real guard.
      if (best < 0 || bestRatio < 0.15) break;
      members.add(best);
      order.push(best);
      internal += boundary.get(best) ?? 0;
      boundary.delete(best);
      for (const e of adjacency.get(best) ?? []) {
        if (members.has(e.to) || (include && !include(e.to))) continue;
        boundary.set(e.to, (boundary.get(e.to) ?? 0) + e.w);
      }
      const cut = [...boundary.values()].reduce((a, b2) => a + b2, 0);
      if (cut > 2.6 * Math.max(internal, 0.001) && order.length >= MIN_BASIN_SIZE) break;
    }
    if (order.length < MIN_BASIN_SIZE) continue;
    // A basin that swallows a third of a large graph is not a feature; it's
    // the graph. (Tiny graphs are gated out by the caller.)
    if (order.length > Math.max(40, n / 3)) continue;
    for (const m of members) claimed.add(m);
    basins.push({ seed, members: order, mass: 0 });
  }
  return basins;
};
