// Progressive disclosure: nested repositories stay outside a root's graph
// until work touches them. A hint or a collapsed porcelain drift crossing a
// .git marker enrolls that boundary (persisted via the fact cache header), and
// from then on the listing crosses exactly the enrolled boundaries.

import { execSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { hasAstGrep } from "../src/core/astgrep.js";
import { listFiles, persistFacts, readEnrolledBoundaries } from "../src/core/build.js";
import { ensureState, evictState } from "../src/core/ops.js";
import { resetSyncBaselines, sync } from "../src/core/sync.js";
import { observeSessionPaths, resetSessions } from "../src/core/session.js";

const git = (cwd: string, args: string): void => {
  execSync(`git -c user.name=t -c user.email=t@t ${args}`, { cwd, stdio: "ignore" });
};

/** Two sibling repos: an inner source, and a superproject holding it as `sub`. */
const makeSuperproject = (): string => {
  const base = mkdtempSync(join(tmpdir(), "fovea-workspace-"));
  const inner = join(base, "seed");
  mkdirSync(inner);
  writeFileSync(join(inner, "a.ts"), "export const inner = 1;\n");
  git(inner, "init -qb main");
  git(inner, "add -A");
  git(inner, "commit -qm init");
  const superRoot = join(base, "super");
  mkdirSync(superRoot);
  writeFileSync(join(superRoot, "top.ts"), "export const top = 1;\n");
  git(superRoot, "init -qb main");
  git(superRoot, `-c protocol.file.allow=always submodule add -q "${inner}" sub`);
  git(superRoot, "add -A");
  git(superRoot, "commit -qm super");
  return superRoot;
};

/** Plain umbrella: two marker-bearing clones, one doubly nested. */
const makeUmbrella = (): string => {
  const root = mkdtempSync(join(tmpdir(), "fovea-umbrella-disclose-"));
  writeFileSync(join(root, "top.ts"), "export const top = 1;\n");
  mkdirSync(join(root, "plain"));
  writeFileSync(join(root, "plain", "seen.ts"), "export const seen = 1;\n");
  mkdirSync(join(root, "repo", ".git"), { recursive: true });
  writeFileSync(join(root, "repo", "inner.ts"), "export const inner = 1;\n");
  mkdirSync(join(root, "repo", "deep", ".git"), { recursive: true });
  writeFileSync(join(root, "repo", "deep", "f.ts"), "export const f = 1;\n");
  mkdirSync(join(root, "repo2", ".git"), { recursive: true });
  writeFileSync(join(root, "repo2", "x.ts"), "export const x = 1;\n");
  return root;
};

describe("progressive disclosure listing", () => {
  it("crosses exactly the enrolled boundaries in a plain umbrella", async () => {
    const root = makeUmbrella();
    try {
      expect(await listFiles(root)).toEqual(["plain/seen.ts", "top.ts"]);
      expect(await listFiles(root, undefined, new Set(["repo"]))).toEqual([
        "plain/seen.ts",
        "repo/inner.ts",
        "top.ts",
      ]);
      expect(await listFiles(root, undefined, new Set(["repo", "repo/deep"]))).toEqual([
        "plain/seen.ts",
        "repo/deep/f.ts",
        "repo/inner.ts",
        "top.ts",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps submodule contents closed in a Git root until enrolled", async () => {
    const superRoot = makeSuperproject();
    try {
      const closed = await listFiles(superRoot);
      expect(closed).toContain("top.ts");
      expect(closed.some((f) => f.startsWith("sub/"))).toBe(false);

      writeFileSync(join(superRoot, "sub", "b.ts"), "export const added = 1;\n");
      const open = await listFiles(superRoot, undefined, new Set(["sub"]));
      expect(open).toContain("sub/a.ts");
      expect(open).toContain("sub/b.ts"); // untracked inside, its .gitignore applies
      // The gitlink itself names a directory and never enters the listing.
      expect(open).not.toContain("sub");
    } finally {
      rmSync(dirname(superRoot), { recursive: true, force: true });
    }
  });

  it("tolerates enrolled but unpopulated submodule checkouts", async () => {
    const superRoot = makeSuperproject();
    try {
      git(superRoot, "submodule deinit -f sub");
      const files = await listFiles(superRoot, undefined, new Set(["sub"]));
      expect(files).toContain("top.ts");
      expect(files.some((f) => f.startsWith("sub/"))).toBe(false);
    } finally {
      rmSync(dirname(superRoot), { recursive: true, force: true });
    }
  });
});

describe.skipIf(!hasAstGrep())("progressive disclosure refresh", () => {
  it("enrolls a nested clone and its parent chain on the first edit hint", async () => {
    const root = makeUmbrella();
    try {
      const st1 = await ensureState(root);
      expect(st1.files).toEqual(["top.ts"].concat(["plain/seen.ts"]).sort());

      const st2 = await ensureState(root, { hints: ["repo/deep/f.ts"] });
      expect([...st2.store.enrolled].sort()).toEqual(["repo", "repo/deep"]);
      expect(st2.files).toContain("repo/inner.ts");
      expect(st2.files).toContain("repo/deep/f.ts");
      // Untouched clones stay closed.
      expect(st2.files).not.toContain("repo2/x.ts");
    } finally {
      evictState(root);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("enrolls a submodule on the first hint and restores coverage after eviction", async () => {
    const superRoot = makeSuperproject();
    try {
      const st1 = await ensureState(superRoot);
      expect(st1.files).not.toContain("sub/a.ts");

      const st2 = await ensureState(superRoot, { hints: ["sub/a.ts"] });
      expect(st2.files).toContain("sub/a.ts");
      expect(st2.facts["sub/a.ts"]).toBeDefined();

      // The fact cache header carries enrollment across process restarts.
      await persistFacts(st2.store);
      expect(await readEnrolledBoundaries(superRoot)).toEqual(["sub"]);
      evictState(superRoot);
      const st3 = await ensureState(superRoot);
      expect(st3.files).toContain("sub/a.ts");
    } finally {
      evictState(superRoot);
      rmSync(dirname(superRoot), { recursive: true, force: true });
    }
  });

  it("auto-enrolls a submodule when drift lands inside without any hint", async () => {
    const superRoot = makeSuperproject();
    try {
      const st1 = await ensureState(superRoot);
      expect(st1.files).not.toContain("sub/a.ts");

      // No pi involvement: porcelain collapses the inner edit to ` M sub`,
      // which the probe reads as a nested-project edit event and enrolls.
      appendFileSync(join(superRoot, "sub", "a.ts"), "export const inner2 = 2;\n");
      const st2 = await ensureState(superRoot);
      expect(st2.files).toContain("sub/a.ts");
      expect(st2.version).not.toBe(st1.version);
      expect(st2.extraction.unreadable).toEqual([]);
      expect(st2.facts["sub/a.ts"]).toBeDefined();
    } finally {
      evictState(superRoot);
      rmSync(dirname(superRoot), { recursive: true, force: true });
    }
  });

  it("un-enrolls a project whose marker vanished, purging its facts", async () => {
    const superRoot = makeSuperproject();
    try {
      await ensureState(superRoot); // cold build ignores hints; refresh enrolls
      const st1 = await ensureState(superRoot, { hints: ["sub/a.ts"] });
      expect(st1.files).toContain("sub/a.ts");

      rmSync(join(superRoot, "sub"), { recursive: true, force: true });
      const st2 = await ensureState(superRoot, { force: true });
      expect([...st2.store.enrolled]).toEqual([]);
      expect(st2.files).not.toContain("sub/a.ts");
      expect(st2.facts["sub/a.ts"]).toBeUndefined();
    } finally {
      evictState(superRoot);
      rmSync(dirname(superRoot), { recursive: true, force: true });
    }
  });

  it("indexes nested drift without steering a session focused elsewhere", async () => {
    const superRoot = makeSuperproject();
    resetSyncBaselines();
    resetSessions();
    try {
      const initial = await ensureState(superRoot);
      const baseline = await sync(
        superRoot,
        {
          files: [],
          budget: 512,
          steerThreshold: 0.01,
          scope: "session",
          sessionId: "session-a",
        },
        initial,
        { probe: "full" },
      );
      expect(baseline.details.baseline).toBe("established");
      observeSessionPaths(superRoot, ["top.ts"]);

      appendFileSync(join(superRoot, "sub", "a.ts"), "export const sibling = 2;\n");
      const outcome = await sync(superRoot, {
        files: [],
        budget: 512,
        steerThreshold: 0.01,
        scope: "session",
        sessionId: "session-a",
      });

      expect(outcome.red).toBe(false);
      expect(outcome.details).toMatchObject({
        outsideAttention: true,
        attentionScopes: ["top.ts"],
      });
      expect(outcome.details.ignoredFiles).toContain("sub/a.ts");
      expect((await ensureState(superRoot)).files).toContain("sub/a.ts");

      const again = await sync(superRoot, {
        files: [],
        budget: 512,
        steerThreshold: 0.01,
        scope: "session",
        sessionId: "session-a",
      });
      expect(again.structural).toBe(false);
    } finally {
      evictState(superRoot);
      rmSync(dirname(superRoot), { recursive: true, force: true });
    }
  });

  it("defers drift detected inside a submodule on the send path", async () => {
    const superRoot = makeSuperproject();
    resetSyncBaselines();
    resetSessions();
    try {
      const st = await ensureState(superRoot);
      const base = await sync(superRoot, { files: [], budget: 512, steerThreshold: 0.01 }, st, {
        probe: "full",
      });
      expect(base.details.baseline).toBe("established");

      appendFileSync(join(superRoot, "sub", "a.ts"), "export const inner3 = 3;\n");
      const outcome = await sync(
        superRoot,
        { files: [], budget: 512, steerThreshold: 0.01 },
        undefined,
        { probe: "defer" },
      );
      // No rebuild on the defer path: the TTL probe spots the collapsed
      // gitlink entry and defers the real work to turn_end.
      expect(outcome.structural).toBe(true);
      expect(outcome.red).toBe(false);
      expect(outcome.details.deferred).toBe(true);
    } finally {
      evictState(superRoot);
      rmSync(dirname(superRoot), { recursive: true, force: true });
    }
  });
});
