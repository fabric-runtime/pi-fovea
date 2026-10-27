// ABI adapter only; decisions and arithmetic come from the checked machines.
import type { DecisionMachine } from "../runtime.ts";
declare const semaphore: DecisionMachine<"out.active" | "out.waiting" | "out.admit" | "out.wake">;
declare const capacity: DecisionMachine<"out.keep" | "out.evict">;
declare const lease: DecisionMachine<"out.valid">;
declare const focus: DecisionMachine<"out.reset">;
declare const fit: DecisionMachine<"out.selected" | "out.cost">;
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
export function semaphoreStep(
  active: number,
  waiting: number,
  limit: number,
  release: boolean,
): { active: number; waiting: number; admit: boolean; wake: boolean } {
  const s = run(semaphore, { active, waiting, limit, release: +release });
  return {
    active: s["out.active"],
    waiting: s["out.waiting"],
    admit: !!s["out.admit"],
    wake: !!s["out.wake"],
  };
}
export function capacityPlan(count: number, limit: number): { keep: number; evict: boolean } {
  const s = run(capacity, { count, limit });
  return { keep: s["out.keep"], evict: !!s["out.evict"] };
}
export function leaseValid(
  epoch: number,
  startedEpoch: number,
  leaseValue: number,
  startedLease: number,
  present: boolean,
): boolean {
  return !!run(lease, { epoch, startedEpoch, lease: leaseValue, startedLease, present: +present })[
    "out.valid"
  ];
}
export function resetFocus(fresh: boolean, generationSame: boolean, keySame: boolean): boolean {
  return !!run(focus, { fresh: +fresh, generationSame: +generationSame, keySame: +keySame })[
    "out.reset"
  ];
}
export function fitStep(
  budget: number,
  index: number,
  cost: number,
  selected: number,
  selectedCost: number,
): { selected: number; cost: number } {
  const s = run(fit, { budget, index, cost, selected, selectedCost });
  return { selected: s["out.selected"], cost: s["out.cost"] };
}
