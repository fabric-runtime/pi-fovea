// Co-change history as a heat memory. The seam this covers: git-history
// affinity used to be a permanent structural edge (stays in the graph across
// syncs and tool calls forever); it is now a recency-decayed seed overlay that
// cools with wall-clock time and is re-seeded only when a change lands.
//
// Unit tests pin the decay + pure overlay math; the git integration drives
// dated commits and asserts the mined timestamps and recency separation; the
// final case runs the real impact() overlay on a fixture with recent joint
// commits.

import { execSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hasAstGrep } from "../src/core/astgrep.js";
import {
  coChangeHistory,
  COCHANGE_HALF_LIFE_DAYS,
  effectiveWeight,
  recencyFactor,
  scorePair,
} from "../src/core/cochange.js";
import type { CoChangeHistory, CoChangePartner } from "../src/core/cochange.js";
import { ensureState, historySeedWeights, impact } from "../src/core/ops.js";
import type { Graph } from "../src/core/types.js";

const DAY = 86_400_000;

describe("co-change history heat", () => {
  it("recency decays exponentially to a half-life and ~0 when ancient", () => {
    expect(recencyFactor(0)).toBe(1);
    expect(recencyFactor(COCHANGE_HALF_LIFE_DAYS)).toBeCloseTo(0.5, 6);
    expect(recencyFactor(40 * COCHANGE_HALF_LIFE_DAYS)).toBeLessThan(1e-12); // 2^-40
    expect(recencyFactor(-5)).toBeGreaterThan(1);
    expect(effectiveWeight(0.4, 0)).toBeCloseTo(0.4, 9);
    expect(effectiveWeight(0.4, COCHANGE_HALF_LIFE_DAYS)).toBeCloseTo(0.2, 6);
  });

  it("base conductance is Jaccard-tilted, count-compressed, and bounded", () => {
    const tight = scorePair(20, 20, 20); // jaccard = 1
    const loose = scorePair(4, 100, 100); // jaccard = 0.04
    expect(tight).toBeGreaterThan(loose);
    expect(tight).toBeLessThanOrEqual(0.5);
    expect(scorePair(0, 0, 0)).toBe(0);
    expect(scorePair(1, 100, 100)).toBeGreaterThan(0.05);
    expect(scorePair(1, 100, 100)).toBeLessThan(0.2);
  });

  it("historySeedWeights re-seeds only non-seed partners, recency-gated", () => {
    const NOW = 1_700_000_000_000;
    const g: Graph = {
      nodes: [
        { id: "a@a.ts", name: "a", kind: "file", file: "a.ts", line: 1, sig: "", lang: "ts" },
        { id: "b@b.ts", name: "b", kind: "file", file: "b.ts", line: 1, sig: "", lang: "ts" },
        { id: "c@c.ts", name: "c", kind: "file", file: "c.ts", line: 1, sig: "", lang: "ts" },
      ],
      edges: [],
      byName: new Map(),
      byFile: new Map([
        ["a.ts", [0]],
        ["b.ts", [1]],
        ["c.ts", [2]],
      ]),
      anchors: [],
      files: ["a.ts", "b.ts", "c.ts"],
    };
    const history: CoChangeHistory = new Map<string, CoChangePartner[]>([
      [
        "a.ts",
        [
          { partner: "b.ts", w: 0.4, lastTs: NOW - 3 * DAY },
          { partner: "c.ts", w: 0.5, lastTs: NOW - 1000 * DAY }, // ancient: must drop out
        ],
      ],
      ["b.ts", [{ partner: "a.ts", w: 0.4, lastTs: NOW - 3 * DAY }]],
    ]);
    const out = historySeedWeights(new Set(["a.ts"]), g, history, NOW);
    expect(out.size).toBe(1);
    expect(out.get("b.ts")).toBeCloseTo(effectiveWeight(0.4, 3), 6);
    expect(out.has("c.ts")).toBe(false); // 1000 days >> half-life
    expect(out.has("a.ts")).toBe(false); // never re-seed the change site
  });
});

describe("co-change history mining (real git)", () => {
  const iso = (ms: number): string => new Date(ms).toISOString();
  const commit = (
    root: string,
    msg: string,
    dateMs: number,
    files: Record<string, string>,
  ): void => {
    for (const [f, text] of Object.entries(files)) writeFileSync(join(root, f), text, "utf8");
    execSync("git add -A", { cwd: root });
    execSync(`git -c user.name=t -c user.email=t@t commit -qm "${msg}"`, {
      cwd: root,
      env: { ...process.env, GIT_AUTHOR_DATE: iso(dateMs), GIT_COMMITTER_DATE: iso(dateMs) },
    });
  };

  it("records the newest joint commit time and separates recency", async () => {
    const root = mkdtempSync(join(tmpdir(), "fovea-cochange-"));
    try {
      execSync("git init -qb main", { cwd: root });
      const NOW = Date.now();
      commit(root, "oldAb1", NOW - 100 * DAY, { "a.ts": "x\n", "b.ts": "y\n" });
      commit(root, "oldAb2", NOW - 90 * DAY, { "a.ts": "x2\n", "b.ts": "y2\n" });
      commit(root, "recentAc1", NOW - 3 * DAY, { "a.ts": "x3\n", "c.ts": "z\n" });
      commit(root, "recentAc2", NOW - 2 * DAY, { "a.ts": "x4\n", "c.ts": "z2\n" });

      const at = NOW + 1000;
      const history = await coChangeHistory(root, ["a.ts", "b.ts", "c.ts"], at);
      const b = (history.get("a.ts") ?? []).find((p) => p.partner === "b.ts");
      const c = (history.get("a.ts") ?? []).find((p) => p.partner === "c.ts");
      expect(b).toBeDefined();
      expect(c).toBeDefined();
      // b last co-moved ~90 days ago, c ~2 days ago.
      expect(b!.lastTs).toBeGreaterThan(at - 91 * DAY);
      expect(b!.lastTs).toBeLessThan(at - 89 * DAY);
      expect(c!.lastTs).toBeGreaterThan(at - 3 * DAY);
      // At `at`, the recent pair is far hotter than the stale one.
      const wB = effectiveWeight(b!.w, (at - b!.lastTs) / DAY);
      const wC = effectiveWeight(c!.w, (at - c!.lastTs) / DAY);
      expect(wC).toBeGreaterThan(wB * 5);
      // Mapping is symmetric: both directions remember the joint history.
      expect((history.get("b.ts") ?? []).some((p) => p.partner === "a.ts")).toBe(true);
      expect((history.get("c.ts") ?? []).some((p) => p.partner === "a.ts")).toBe(true);
      // A fresh call (any process, same HEAD + tracked set) serves the same
      // raw facts; decay is applied at use, not here.
      const again = await coChangeHistory(root, ["a.ts", "b.ts", "c.ts"], at);
      expect(again).toEqual(history);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!hasAstGrep())("impact history overlay on a real graph", () => {
  const SRC = new URL("./fixtures/mini", import.meta.url).pathname;
  const iso = (ms: number): string => new Date(ms).toISOString();

  it("re-seeds a recent co-changer and labels it co-change history", async () => {
    const root = mkdtempSync(join(tmpdir(), "fovea-cochange-impact-"));
    try {
      cpSync(SRC, root, { recursive: true });
      execSync("git init -qb main && git add -A", { cwd: root });
      execSync("git -c user.name=t -c user.email=t@t commit -qm init", { cwd: root });
      const users = join(root, "server/users.go");
      const main = join(root, "server/main.go");
      const commit = (msg: string, dateMs: number): void => {
        writeFileSync(users, readFileSync(users, "utf8") + "\n// joint\n");
        writeFileSync(main, readFileSync(main, "utf8") + "\n// joint\n");
        execSync("git add -A", { cwd: root });
        execSync(`git -c user.name=t -c user.email=t@t commit -qm "${msg}"`, {
          cwd: root,
          env: { ...process.env, GIT_AUTHOR_DATE: iso(dateMs), GIT_COMMITTER_DATE: iso(dateMs) },
        });
      };
      commit("joint1", Date.now() - 3 * DAY);
      commit("joint2", Date.now() - DAY);

      await ensureState(root);
      const r = await impact(root, {
        files: ["server/users.go"],
        includeUncommitted: false,
        budget: 4000,
      });
      expect(Number(r.details.historyPartners)).toBeGreaterThanOrEqual(1);
      const reasons = r.details.warmedReasons as Record<string, string[]>;
      const withHistory = Object.entries(reasons).filter(([, arr]) =>
        arr.includes("co-change history"),
      );
      expect(withHistory.length).toBeGreaterThan(0);
      expect(withHistory.some(([f]) => f === "server/main.go")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
