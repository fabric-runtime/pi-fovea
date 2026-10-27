# Snapshot substrate v1

`pi-fovea/substrate` is a small, session-free entrypoint for graph consumers. It does not enroll roots, discover files, read project rules, perform extraction, or inspect the current working tree.

```ts
import {
  SUBSTRATE_VERSION,
  assembleFactGraph,
  diffuseMass,
  type SnapshotFacts,
} from "pi-fovea/substrate";

if (SUBSTRATE_VERSION !== 1) throw new Error("Unsupported substrate version");
const facts = new Map<string, SnapshotFacts>();
// Populate immutable per-file symbol/import/call/literal/anchor facts.
const graph = await assembleFactGraph(facts);
const source = new Float64Array(graph.nodes.length);
// Assign nonnegative source mass to graph node indices.
const fields = diffuseMass(graph, source, [0.5, 2, 8]);
```

`SnapshotFacts` is the explicit projection of Fovea's extraction-fact shape. Its legacy `sha1` field is caller-owned content identity; graph assembly does not interpret that digest. Every site must name its owning repository-relative file. Unsafe paths and cross-file witnesses are rejected. Callers own source coverage and must keep supplied facts immutable during assembly.

The resulting `Graph` retains nodes, typed relationship evidence, file/name indexes, and import coverage. Callers can select or reweight relationships without introducing a second graph resolver. Navigation conductances are not calibrated defect probabilities.

`diffuseMass` accepts a graph, a finite nonnegative source vector matching the node count, and finite times in [0,64]. Results are `{ time, mass: Float64Array }` in requested order. It shares Chebyshev recurrence vectors across times and applies the forward random-walk conjugation of the symmetric heat kernel. Isolates retain their original mass. Floating-point conservation is approximate; tests cover it against existing solver paths, whose independent reference tests remain in the core suite.

## Direct interval solve

```ts
import { solveDiffusion } from "pi-fovea/substrate";

const result = await solveDiffusion(graph, source, 8, {
  absoluteTolerance: 1e-8,
  maxWork: 100_000,
});
if (!result.withinTolerance) throw new Error("Insufficient enclosure precision");
// result.value is computed from the u32 interval enclosure, not Chebyshev.
```

`solveDiffusion` uses exact rational edge normalization and the shared u32-limb
Poisson core. It does not run the Float64 candidate solver. Input/output arrays
remain Float64 for API compatibility; arithmetic after decoding uses integer
limbs and outward intervals. It returns the same certificate shape, including
`precisionBits`, `lower`, `upper`, `maxAbsoluteError`, and explicit assumptions.
The existing `diffuseMass` remains the fast multi-time path, and
`certifyDiffusion` continues to verify that path's actual result.

See [exact heat](exact-heat.md) for execution and proof boundaries.

## Opt-in interval verification

```ts
import { certifyDiffusion } from "pi-fovea/substrate";

const certificate = await certifyDiffusion(graph, source, 8, {
  absoluteTolerance: 1e-8,
  maxWork: 100_000,
});
if (!certificate.withinTolerance) {
  throw new Error(`Diffusion error bound: ${certificate.maxAbsoluteError}`);
}
// certificate.value is the actual diffuseMass output.
// certificate.lower/upper enclose the independent exact-edge-normalized target.
```

This computes a separate u32-interval Poisson expansion; it does not compare two
Float64 approximations or replace the production Chebyshev result. It includes
normalization, coefficient, recurrence, summation and pruning disagreement in
one final bound. Isolates retain their source values in the reference target.
`poissonOrder`, `remainderBound`, `work`, and `assumptions` expose the evidence.

This is a **conditional runtime certificate**, not an unconditional formal
matrix-exponential theorem. The interval/limb implementation, JS arithmetic,
and correspondence to the analytic model remain assumptions. The separate
Lean proofs establish the Poisson identity and stochastic norm bounds. A
separate gdp-wired model now proves constructive scalar-tail convergence, not that
the TypeScript evaluator implements those definitions; see
[the exact proof boundary](proofs.md#lean-numerical-models-28-checked-theorems). Rounded
CSR degrees are not assumed exact: the reference recomputes normalization from
the exact binary edge weights. Source/candidate snapshots are taken before the
lazy verifier is loaded; callers still own graph immutability during each call.

Finite times remain in [0,64]. Work counts normalization/operator visits, not
wall-clock time or the fast candidate computation. At most 512 Poisson iterations
and 1,000,000 reference visits are allowed. Invalid inputs, insufficient precision,
or exhausted work reject the promise; an excessive candidate error returns
`withinTolerance: false`. Normal `diffuseMass` calls do not load this verifier.

No session, disclosure, snapshot cache, or quality policy is implied by this API. Consumers such as pi-contour supply immutable Git/index snapshots, analysis-specific projections, source evidence, and their own bounded caches.
