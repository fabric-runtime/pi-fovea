export type DisclosureDecision = { $: "Drop" } | { $: "Suppress" } | { $: "Reveal" };
export type BasisStep =
  | { $: "Empty" }
  | { $: "Complete" }
  | { $: "First" }
  | { $: "Next"; at: number; previous: number; older: number };
