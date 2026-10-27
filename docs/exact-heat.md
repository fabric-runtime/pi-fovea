# Exact sparse heat core

`solveDiffusion` (public substrate) and `solveHeat` (core boundary) compute heat
from a shared u32-limb Poisson enclosure. They do not execute the Float64
Chebyshev candidate. `certifyDiffusion` and `certifyHeat` retain their existing
candidate-checking behavior and use the same exact reference implementation.

## Representation and execution

- `normalization.ts` decodes finite nonnegative Float64 weights once into exact
  dyadics. Stored floating degree sums are not trusted.
- `exact-operator.ts` owns canonical CSR indices, integer edge numerators and
  positive row denominators. It requires exact row mass, copies caller buffers,
  and caches outward probability intervals. Empty input rows become explicit
  identity self-loops through the normalizer.
- The generated `sparseEdgeStep` advances the actual edge cursor and selects the
  gather/scatter coordinates. Seven gdp-wired laws cover its admission, bounds,
  direction, progress and refusal behavior.
- `exact-heat.ts` propagates signed positive/negative interval vectors and checks
  the omitted Poisson tail. `exact-series.ts` supplies the shared scalar series;
  the old scalar and Bessel wrappers use that same recurrence.
- Float64 decoding and final outward conversion remain boundary operations.
  The fast solver remains available; this is not a blanket typed-array rename.

## Limits and refusal

The interval scale has 192 fractional bits. The exact sparse core accepts at
most 128 u32 limbs per stored endpoint/weight. Work admission uses the existing
checked budget decision, with at most 1,000,000 structural node/edge visits;
normalization, canonical CSR preparation and each operator application are
charged. This is not a wall-clock or individual limb-instruction budget.
The scalar and Poisson loops have a 512-term cap. Time is in `[0,64]`.

Invalid CSR, row mass, denominators, intervals, capacities or budgets throw.
An unattainable tail cutoff throws; a finished enclosure too wide for the
requested tolerance returns `withinTolerance: false`. Always check that field.
No overflow is accepted as wraparound, and no precision limit is reported as a
successful certificate. `precisionBits` reports the current scale.

## What is proved

The generated arithmetic streams, rounding/work decisions, and new sparse edge
control are executed from checked sources. Independent tests check signed
non-dyadic matrix products against BigInt rational arithmetic, input ownership,
corrupt degree data, extreme dyadic weights, and analytic heat solutions.

This does not make the entire host loop or Float64 codec formally verified.
Array traversal/refinement and the complete end-to-end numerical theorem remain
conditional, as reported by certificate `assumptions` and `docs/proofs.md`.

## Performance observation

One cold Modal pilot (two CPUs), 200 nodes, 400 arcs, time 2, tolerance `1e-8`:
Float64 candidate about 72 ms; direct exact solve about 128 ms, 10,800 charged
visits and 15 Poisson orders. Their largest coordinate difference was about
`8.5e-11`. This single observation is not a benchmark guarantee. It supports
keeping the fast path rather than removing it before broader measurement.
