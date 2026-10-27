// Exact indexed signed transport. Complete rounds may use different sparse
// nonnegative kernels; each source distributes exactly one denominator of weight.
// A/B alternate roles, so no unbounded bulk-copy is hidden in a transition.
// Coordinates are canonical: p=0 or n=0, hence sum(p+n) is the true L1 norm.
// This is an exact model, not yet a refinement proof of the interval/CSR code.
import { rule, nat, bool, record, when, forall, Term } from "gdp-wired";
import type { Cond } from "gdp-wired";
import type { ProofGroup, SignedBuffers, SignedCell } from "./types.ts";
const Pair = record({ p: nat, n: nat });
const one = new Term({ op: "const", value: 1 });
const term = (name: string) => new Term({ op: "var", name });
const mass = (x: SignedCell) => x.p.plus(x.n);
export const currentMass = (e: SignedBuffers) => when(e.phase.eq(0), e.A.sum(mass), e.B.sum(mass));
const nextMass = (e: SignedBuffers) => when(e.phase.eq(0), e.B.sum(mass), e.A.sum(mass));
export const transport = rule("indexed_signed_transport")
  .params({ divisor: nat })
  .pre((e) => e.divisor.gt(0))
  .inputs({ action: nat, at: nat, magnitude: nat, negative: bool, weight: nat })
  .state({
    started: 0,
    phase: 0,
    remaining: 0,
    pendingP: 0,
    pendingN: 0,
    denominator: 1,
    initialNorm: 0,
    bound: 0,
    round: 0,
  })
  .maps({ A: Pair.from({ p: 0, n: 0 }), B: Pair.from({ p: 0, n: 0 }) })
  .flags((e) => ({
    seed: e.action.eq(0).and(e.started.eq(0), mass(e.A.at(e.at)).eq(0)),
    begin: e.action.eq(1).and(e.remaining.eq(0)),
    emit: e.action.eq(2).and(e.started.eq(1), e.weight.atMost(e.remaining)),
    flip: e.action.eq(3).and(e.started.eq(1), e.remaining.eq(0), currentMass(e).eq(0)),
  }))
  .step((e) => {
    const a = e.A.at(e.at),
      b = e.B.at(e.at),
      sourceP = when(e.phase.eq(0), a.p, b.p),
      sourceN = when(e.phase.eq(0), a.n, b.n);
    const seedP = when(e.negative, 0, e.magnitude),
      seedN = when(e.negative, e.magnitude, 0);
    const write = (cell: SignedCell, phase: number, seed?: Cond) => {
      const p = when(
        e.begin.and(e.phase.eq(phase)),
        0,
        when(
          e.emit.and(e.phase.eq(1 - phase)),
          cell.p.plus(e.weight.mul(e.pendingP)).minus(cell.n.plus(e.weight.mul(e.pendingN))),
          cell.p,
        ),
      );
      const n = when(
        e.begin.and(e.phase.eq(phase)),
        0,
        when(
          e.emit.and(e.phase.eq(1 - phase)),
          cell.n.plus(e.weight.mul(e.pendingN)).minus(cell.p.plus(e.weight.mul(e.pendingP))),
          cell.n,
        ),
      );
      return { p: seed ? when(seed, seedP, p) : p, n: seed ? when(seed, seedN, n) : n };
    };
    return {
      started: when(e.begin, 1, e.started),
      phase: when(e.flip, one.minus(e.phase), e.phase),
      remaining: when(e.begin, e.divisor, when(e.emit, e.remaining.minus(e.weight), e.remaining)),
      pendingP: when(e.begin, sourceP, e.pendingP),
      pendingN: when(e.begin, sourceN, e.pendingN),
      denominator: when(e.flip, e.denominator.mul(e.divisor), e.denominator),
      bound: when(e.seed, e.bound.plus(e.magnitude), when(e.flip, e.bound.mul(e.divisor), e.bound)),
      initialNorm: when(e.seed, e.initialNorm.plus(e.magnitude), e.initialNorm),
      round: when(e.flip, e.round.plus(1), e.round),
      A: e.A.set(e.at, write(a, 0, e.seed)),
      B: e.B.set(e.at, write(b, 1)),
    };
  });
export const transportLaws = [
  ...(["A", "B"] as const).map((name) =>
    transport.law(`transport_${name}_canonical`, (e) =>
      forall((k) => e[name].at(k).p.eq(0).or(e[name].at(k).n.eq(0))),
    ),
  ),
  transport.law("transport_phase_bit", (e) => e.phase.atMost(1)),
  transport.law("transport_started_bit", (e) => e.started.atMost(1)),
  transport.law("transport_seed_phase", (e) =>
    e.started.eq(0).implies(e.phase.eq(0).and(e.denominator.eq(1), e.remaining.eq(0))),
  ),
  transport.law("transport_denominator_positive", (e) => e.denominator.gt(0)),
  transport.law("transport_weight_budget", (e) => e.remaining.atMost(e.divisor)),
  transport.law("transport_scale_exact", (e) => e.bound.eq(e.initialNorm.mul(e.denominator))),
  transport.law("transport_indexed_mass_ledger", (e) =>
    e.divisor
      .mul(currentMass(e))
      .plus(e.remaining.mul(e.pendingP.plus(e.pendingN)))
      .plus(nextMass(e))
      .atMost(e.divisor.mul(e.bound)),
  ),
];
export const transportBudget = transport.law("transport_current_budget", (e) =>
  currentMass(e).atMost(e.bound),
);
export const transportNorm = transport.law("transport_global_l1_bound", (e) =>
  currentMass(e).atMost(e.initialNorm.mul(e.denominator)),
);
export const transportSteps = [
  transport.stepLaw(
    "transport_completed_round_bound",
    (a) => nextMass(a).atMost(a.divisor.mul(a.bound)),
    (e) => e.flip,
  ),
  transport.stepLaw(
    "transport_round_progress",
    (a, b) => b.round.eq(a.round.plus(1)).and(b.denominator.eq(a.denominator.mul(a.divisor))),
    (e) => e.flip,
  ),
  transport.stepLaw(
    "transport_weight_consumed",
    (a, b) => b.remaining.plus(a.weight).eq(a.remaining),
    (e) => e.emit,
  ),
];
const support = {
  transport_A_canonical: [],
  transport_B_canonical: [],
  transport_phase_bit: [],
  transport_started_bit: [],
  transport_seed_phase: [],
  transport_denominator_positive: [],
  transport_weight_budget: [],
  transport_scale_exact: ["transport_seed_phase"],
  transport_indexed_mass_ledger: ["transport_phase_bit", "transport_seed_phase"],
};
const cuts: import("gdp-wired/solver").Lin[] = [
  { phase: 1 },
  { action: 1 },
  { action: 1, "1": -1 },
  { action: 1, "1": -2 },
];
export const transportProofs: ProofGroup[] = [
  {
    name: "indexed_transport",
    machine: transport.withSumsOf(...transportLaws).machine,
    laws: transportLaws,
    polynomial: ["transport_scale_exact", "transport_indexed_mass_ledger"],
    supports: support,
    instances: (l) => (l.forall ? { [l.name]: [term(l.forall + "#").e] } : {}),
    search: (l) =>
      l.name === "transport_indexed_mass_ledger"
        ? { ms: 12000, nodes: 512, products: 6000, rows: 12000, closureRounds: 1, cuts }
        : l.name === "transport_scale_exact"
          ? { nodes: 192, products: 2500, rows: 5000, closureRounds: 1 }
          : l.name.endsWith("_canonical")
            ? {
                ms: 8000,
                nodes: 256,
                cuts: [
                  { [l.forall + "#"]: 1, at: -1 },
                  { [l.forall + "#"]: -1, at: 1 },
                ],
              }
            : {},
  },
  {
    name: "transport_budget",
    from: "indexed_transport",
    laws: [transportBudget],
    polynomial: true,
    supports: {
      transport_current_budget: ["transport_indexed_mass_ledger", "transport_phase_bit"],
    },
  },
  {
    name: "transport_norm",
    from: "indexed_transport",
    using: ["transport_budget"],
    laws: [transportNorm],
    polynomial: true,
    supports: { transport_global_l1_bound: ["transport_current_budget", "transport_scale_exact"] },
  },
  {
    name: "transport_steps",
    from: "indexed_transport",
    steps: true,
    laws: transportSteps,
    polynomial: true,
    supports: {
      transport_completed_round_bound: ["transport_indexed_mass_ledger", "transport_phase_bit"],
      transport_round_progress: [],
      transport_weight_consumed: [],
    },
  },
];
export const transportLawNames = transportProofs.flatMap((p) => p.laws.map((l) => l.name));
