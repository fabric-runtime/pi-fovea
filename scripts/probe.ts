// Light status probe across repos: build stats + anchor/rule coverage.
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { ensureState, sketch } from "../src/core/ops.js";
import { resetSessions } from "../src/core/session.js";
for (const arg of process.argv.slice(2)) {
  const root = resolve(arg);
  resetSessions();
  const t0 = performance.now();
  const state = await ensureState(root);
  const ms = performance.now() - t0;
  const g = state.graph;
  const litEdges = g.edges.filter((e) => e.kind === "join").length;
  const callEdges = g.edges.filter((e) => e.kind === "invokes").length;
  console.log(
    root.split("/").pop() +
      ": " +
      [
        g.files.length + " files",
        g.nodes.length + " nodes",
        g.edges.length + " edges",
        g.anchors.length + " anchors",
        litEdges + " join-edges",
        callEdges + " call-edges",
        ms.toFixed(0) + "ms build",
      ].join(", "),
  );
  resetSessions();
  const t1 = performance.now();
  const s = await sketch(root, 400);
  console.log(
    "  sketch: " +
      s.tokens +
      " tok, " +
      (performance.now() - t1).toFixed(0) +
      "ms, groups in body: " +
      s.text.split("\n").length,
  );
}
