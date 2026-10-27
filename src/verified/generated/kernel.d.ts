// Generated ABI; see proofs/kernel-abi.json.
export type DisclosureDecision = { $: "Drop" } | { $: "Suppress" } | { $: "Reveal" };
export type BasisStep = { $: "Empty" } | { $: "Complete" } | { $: "First" }
  | { $: "Next"; at: number; previous: number; older: number };

export declare function disclosure(scope: boolean, excluded: boolean, seen: boolean, repeat: boolean, nucleus: boolean): DisclosureDecision;
export declare function shownCount(total: number, requested: number): number;
export declare function remainingCount(total: number, requested: number): number;
export declare function basisStep(have: number, order: number): BasisStep;
