export type DisclosureDecision = { $: "Drop" } | { $: "Suppress" } | { $: "Reveal" };
export type BasisStep = { $: "Empty" } | { $: "Complete" } | { $: "First" }
  | { $: "Next"; at: bigint; previous: bigint; older: bigint };
