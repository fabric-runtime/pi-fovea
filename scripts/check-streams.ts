import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  obligations,
  assumed,
  loopObligations,
  foldObligations,
  stepLawObligations,
  sideGoals,
  check,
} from "gdp-wired/kernel";
import type { Goal } from "gdp-wired/kernel";
import type { Law } from "gdp-wired/machine";
import { grow, cellProducts } from "gdp-wired/prove";
import { streamProofs } from "../proofs/streams.ts";
import type { MachineProof, ProofClaim, ProofGroup } from "../proofs/types.ts";
import { provePolynomial } from "./prove-polynomial.ts";

// A support list can only remove hypotheses. Invariant supports belong to the
// same mutually inductive group; derived supports must already be proved.
function supportFor(proof: ProofGroup, claim: ProofClaim, available: Law[]): Law[] {
  const names = proof.supports?.[claim.name];
  if (!names) return available;
  return names.map((name) => {
    const found = available.find((law) => law.name === name);
    if (!found) throw new Error(`${claim.name}: unknown support ${name}`);
    return found;
  });
}

function invariantBasis(
  proof: ProofGroup,
  proved: Map<string, ProofGroup>,
): MachineProof | undefined {
  if (!proof.from) return;
  const basis = proved.get(proof.from);
  if (!basis) throw new Error(`${proof.name}: missing proved invariant group`);
  if (!basis.machine || basis.from || basis.loop || basis.fold || basis.steps) {
    throw new Error(`${proof.name}: expected a checked invariant group`);
  }
  return basis;
}

function goalsFor(proof: ProofGroup, basis: MachineProof | undefined, available: Law[]): Goal[] {
  if (proof.steps) {
    if (!basis) throw new Error(`${proof.name}: missing proved invariant group`);
    return proof.laws.flatMap((law) =>
      stepLawObligations(
        basis.machine,
        supportFor(proof, law, available),
        proof.instances?.(law) ?? {},
        law,
      ),
    );
  }
  if (proof.fold) return foldObligations(proof.fold, proof.laws);
  if (proof.from) {
    if (!basis) throw new Error(`${proof.name}: missing proved invariant group`);
    return proof.laws.map((law) => ({
      name: law.name,
      hyps: [
        ...(basis.machine.pre ? [basis.machine.pre] : []),
        // Quantified invariants must be instantiated at this goal's keys,
        // never reused as formulas with unrelated free witness names.
        ...assumed(supportFor(proof, law, available), proof.instances?.(law) ?? {}),
        ...(proof.inputs && basis.machine.assume ? [basis.machine.assume] : []),
        { op: "not", x: law.holds },
      ],
    }));
  }
  if (proof.loop) return loopObligations(proof.loop, proof.laws, proof.rank);
  if (!proof.machine) throw new Error(`${proof.name}: missing invariant machine`);
  if (proof.supports || proof.instances) {
    return [
      ...proof.laws.flatMap((law) =>
        obligations(
          proof.machine,
          [law, ...supportFor(proof, law, proof.laws).filter((support) => support !== law)],
          { [law.name]: proof.instances?.(law) ?? {} },
          0,
        ),
      ),
      ...sideGoals(proof.machine),
    ];
  }
  return obligations(proof.machine, proof.laws);
}

export function checkProofGroups(proofs: ProofGroup[], { ms = 15000 } = {}): number {
  if (!Number.isFinite(ms) || ms <= 0) throw new Error("Positive finite proof deadline required");
  const previous = cellProducts.on;
  const deadline = performance.now() + ms;
  cellProducts.on = true;
  try {
    const proved = new Map<string, ProofGroup>();
    let count = 0;
    for (const proof of proofs) {
      if (
        [proof.machine, proof.fold, proof.loop, proof.from].filter(Boolean).length !== 1 ||
        (proof.steps && !proof.from)
      ) {
        throw new Error(`${proof.name}: incompatible proof modes`);
      }
      if (proved.has(proof.name)) throw new Error(`${proof.name}: duplicate proof group`);
      const basis = invariantBasis(proof, proved);
      const available = basis ? [...basis.laws] : proof.steps ? [] : [...proof.laws];
      for (const name of proof.using ?? []) {
        const prior = proved.get(name);
        if (!basis || !prior || prior.from !== proof.from || prior.inputs || prior.steps) {
          throw new Error(`${proof.name}: inadmissible prior consequence ${name}`);
        }
        available.push(...prior.laws);
      }
      for (const goal of goalsFor(proof, basis, available)) {
        const claim = proof.laws.find(
          (law) => goal.name === law.name || goal.name.startsWith(law.name + " @"),
        );
        const search = (claim && proof.search?.(claim)) || {};
        const until = Math.min(deadline, performance.now() + (search.ms ?? 4000));
        const usePolynomial = Array.isArray(proof.polynomial)
          ? proof.polynomial.some((name) => goal.name === name || goal.name.startsWith(name + " @"))
          : !!proof.polynomial;
        const polynomial = usePolynomial
          ? provePolynomial(goal, until, undefined, search)
          : undefined;
        const result = usePolynomial
          ? polynomial
            ? { tree: polynomial }
            : { stuck: "polynomial search budget or capability" }
          : grow(goal, undefined, { nodes: 20000, until });
        if (!("tree" in result) || !result.tree || !check(goal, result.tree)) {
          throw new Error(
            `${goal.name}: proof refused ${JSON.stringify("tree" in result ? { checked: false } : result)}`,
          );
        }
      }
      proved.set(proof.name, proof);
      count += proof.loop ? 1 : proof.laws.length;
    }
    return count;
  } finally {
    cellProducts.on = previous;
  }
}

export const checkStreams = (proofs = streamProofs) => checkProofGroups(proofs);
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error("usage: tsx scripts/check-streams.ts");
    console.log(`${checkStreams()} arithmetic stream claims proved and checked; no Lean loaded`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
