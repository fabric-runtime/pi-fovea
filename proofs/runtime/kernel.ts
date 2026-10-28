// ABI adapter only; decisions and arithmetic come from the checked machines.
import type { DecisionMachine } from "../runtime.ts";
import type { BasisStep, DisclosureDecision } from "../kernel-types.d.ts";
declare const disclosureMachine: DecisionMachine<"out.tag">;
declare const counts: DecisionMachine<"out.shown" | "out.remaining">;
declare const basis: DecisionMachine<"out.tag" | "out.at" | "out.previous" | "out.older">;
const u32 = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 4294967295)
    throw new RangeError("Expected u32");
  return value;
};
const run = <Output extends string>(m: DecisionMachine<Output>, input: Record<string, number>) => {
  for (const value of Object.values(input)) u32(value);
  const scalars = m.step({}, m.init({}), input).scalars;
  for (const value of Object.values(scalars)) u32(value);
  return scalars;
};
const natural = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 4294967295)
    throw new RangeError("Expected u32");
  return value;
};
const boolean = (value: unknown): number => {
  if (typeof value !== "boolean") throw new TypeError("Expected Boolean");
  return +value;
};
export function disclosure(
  scope: boolean,
  excluded: boolean,
  seen: boolean,
  repeat: boolean,
  nucleus: boolean,
): DisclosureDecision {
  const s = run(disclosureMachine, {
    scope: boolean(scope),
    excluded: boolean(excluded),
    seen: boolean(seen),
    repeat: boolean(repeat),
    nucleus: boolean(nucleus),
  });
  return { $: (["Drop", "Suppress", "Reveal"] as const)[s["out.tag"]]! };
}
export function shownCount(total: number, requested: number): number {
  return natural(
    run(counts, { total: natural(total), requested: natural(requested) })["out.shown"],
  );
}
export function remainingCount(total: number, requested: number): number {
  return natural(
    run(counts, { total: natural(total), requested: natural(requested) })["out.remaining"],
  );
}
export function basisStep(have: number, order: number): BasisStep {
  const s = run(basis, { have: natural(have), order: natural(order) }),
    tag = (["Empty", "Complete", "First", "Next"] as const)[s["out.tag"]]!;
  return tag === "Next"
    ? {
        $: tag,
        at: natural(s["out.at"]),
        previous: natural(s["out.previous"]),
        older: natural(s["out.older"]),
      }
    : { $: tag };
}
