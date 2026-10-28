// Tier-3 discovery: harvest mechanics, the promotion statistic, and an
// end-to-end promotion against the fixture's made-up jobm DSL.

import { describe, expect, it } from "vitest";
import { aggregateFiles, harvestFile, promote, synthesize } from "../src/core/discover.js";
import { ensureState } from "../src/core/ops.js";
import { resetSessions } from "../src/core/session.js";

const FIXTURE = new URL("./fixtures/mini", import.meta.url).pathname;

describe("harvest", () => {
  it("extracts callee/shape/argIdx and scores path-ness", () => {
    const py = 'jobm.schedule("/ops/defrag", defrag)\nprint(jobm.note("no slash here"))\n';
    const sigs = harvestFile("Python", py);
    expect(sigs["Python|recv|schedule|0"]).toEqual([1, 1]);
    // plain-text string arg → sites counted, path not
    expect(sigs["Python|recv|note|0"]).toEqual([1, 0]);
  });

  it("tools with fewer than 4 sites or 2 files stay un-promoted", () => {
    const one = aggregateFiles({ "a.py": { "Python|recv|rare|0": [3, 3] } });
    expect(promote(one)).toEqual([]);
  });

  it("junk with great frequency is rejected by precision", () => {
    const sigs = aggregateFiles({
      "a.kt": { "Kotlin|bare|assertEquals|0": [120, 30] },
      "b.kt": { "Kotlin|bare|assertEquals|0": [115, 31] },
    });
    expect(promote(sigs)).toEqual([]);
    const real = aggregateFiles({
      "a.kt": { "Kotlin|bare|wire|0": [10, 9] },
      "b.kt": { "Kotlin|bare|wire|0": [10, 8] },
    });
    const promoted = promote(real);
    expect(promoted.length).toBe(1);
    expect(promoted[0]!.id).toContain("wire");
    expect(promoted[0]!.implicit).toBe(true);
  });
});

describe("synthesize", () => {
  it("puts $P at the proven arg position and offers an arity tail variant", () => {
    const s = aggregateFiles({
      "a.ts": { "TypeScript|recv|deliver|2": [6, 6] },
      "b.ts": { "TypeScript|recv|deliver|2": [4, 4] },
    })[0]!;
    const rule = synthesize(s)!;
    expect(rule.patterns[0]).toContain("$P");
    expect(rule.patterns[0]).toContain("$X0");
    expect(rule.patterns[1]).toContain("$$$H");
  });
});

describe("integration on the mini repo", () => {
  it("promotes the unknown jobm DSL surfaces as implicit half-weight hubs", async () => {
    resetSessions();
    const st = await ensureState(FIXTURE);
    const jobAnchor = st.graph.anchors.find((a) => a.id.includes("/ops/defrag"));
    expect(jobAnchor).toBeDefined();
    expect(jobAnchor!.implicit).toBe(true);
    expect(jobAnchor!.label.toLowerCase()).toContain("schedule");
  });

  it("tier-1-pack anchors stay first-class when discovery fires too", async () => {
    resetSessions();
    const st = await ensureState(FIXTURE);
    const airports =
      st.graph.anchors.find((a) => a.id === "ANY /api/airports/{*}") ??
      st.graph.anchors.find((a) => a.id === "GET /api/airports/{*}");
    expect(airports).toBeDefined();
    expect(airports!.implicit ?? false).toBe(false);
  });
});
