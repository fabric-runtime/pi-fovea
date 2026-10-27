// Independent specifications: never weaken these to accommodate an implementation.
import { min } from "gdp-wired";
import type { kernels } from "./kernel.ts";
import type { controls } from "./controls.ts";
export function kernelLaws({ disclosure: d, counts: c, basis: b }: typeof kernels) {
  return [
    d.law(
      "scope_wins",
      (e) => e.scope.not(),
      (o) => o.tag.eq(0),
    ),
    d.law(
      "exclusion_wins",
      (e) => e.excluded,
      (o) => o.tag.eq(0),
    ),
    d.law(
      "fresh_revealed",
      (e) => e.scope.and(e.excluded.not(), e.seen.not()),
      (o) => o.tag.eq(2),
    ),
    d.law(
      "seen_suppressed",
      (e) => e.scope.and(e.excluded.not(), e.seen, e.repeat.not()),
      (o) => o.tag.eq(1),
    ),
    d.law(
      "periphery_suppressed",
      (e) => e.scope.and(e.excluded.not(), e.seen, e.nucleus.not()),
      (o) => o.tag.eq(1),
    ),
    d.law(
      "nucleus_repeated",
      (e) => e.scope.and(e.excluded.not(), e.repeat, e.nucleus),
      (o) => o.tag.eq(2),
    ),
    c.law(
      "shown_bounded_by_total",
      () => [],
      (o, e) => o.shown.atMost(e.total),
    ),
    c.law(
      "shown_bounded_by_request",
      () => [],
      (o, e) => o.shown.atMost(e.requested),
    ),
    c.law(
      "counts_conserved",
      () => [],
      (o, e) => o.shown.plus(o.remaining).eq(e.total),
    ),
    c.law(
      "full_prefix_omits_nothing",
      (e) => e.total.eq(e.requested),
      (o) => o.remaining.eq(0),
    ),
    c.law(
      "cap_idempotent",
      () => [],
      (o, e) => min(o.shown, e.requested).eq(o.shown),
    ),
    b.law(
      "basis_empty_refused",
      (e) => e.have.eq(0),
      (o) => o.tag.eq(0),
    ),
    b.law(
      "basis_complete_retained",
      (e) => e.have.gt(0).and(e.have.gt(e.order)),
      (o) => o.tag.eq(1),
    ),
    b.law(
      "basis_first_order",
      (e) => e.have.eq(1).and(e.order.atLeast(1)),
      (o) => o.tag.eq(2),
    ),
    b.law(
      "basis_next_exact",
      (e) => e.have.atLeast(2).and(e.have.atMost(e.order)),
      (o, e) =>
        o.tag.eq(3).and(o.at.eq(e.have), o.previous.plus(1).eq(e.have), o.older.plus(2).eq(e.have)),
    ),
  ];
}
export function controlLaws({
  semaphore: s,
  capacity: c,
  lease: l,
  focus: f,
  fit: p,
}: typeof controls) {
  return [
    s.law(
      "semaphore_bounded",
      () => [],
      (o, e) => o.active.atMost(e.limit),
    ),
    s.law(
      "semaphore_waits_at_capacity",
      (e) => e.release.not().and(e.active.eq(e.limit)),
      (o) => o.admit.not(),
    ),
    s.law(
      "semaphore_admits_free_slot",
      (e) => e.release.not().and(e.active.lt(e.limit)),
      (o) => o.admit,
    ),
    s.law(
      "semaphore_handoff_reserves_slot",
      (e) => e.release.and(e.waiting.gt(0)),
      (o, e) => o.wake.and(o.active.eq(e.active), o.waiting.plus(1).eq(e.waiting)),
    ),
    s.law(
      "semaphore_release_without_waiter",
      (e) => e.release.and(e.waiting.eq(0)),
      (o, e) => o.wake.not().and(o.active.plus(1).eq(e.active)),
    ),
    s.law(
      "semaphore_free_slot_counted",
      (e) => e.release.not().and(e.active.lt(e.limit)),
      (o, e) => o.active.eq(e.active.plus(1)).and(o.waiting.eq(e.waiting)),
    ),
    s.law(
      "semaphore_busy_arrival_queued",
      (e) => e.release.not().and(e.active.eq(e.limit)),
      (o, e) => o.active.eq(e.active).and(o.waiting.eq(e.waiting.plus(1))),
    ),
    c.law(
      "capacity_keeps_room",
      () => [],
      (o, e) => o.keep.lt(e.limit),
    ),
    c.law(
      "capacity_no_unnecessary_eviction",
      (e) => e.count.lt(e.limit),
      (o, e) => o.evict.not().and(o.keep.eq(e.count)),
    ),
    c.law(
      "capacity_at_limit_evicts",
      (e) => e.count.atLeast(e.limit),
      (o) => o.evict,
    ),
    l.law(
      "stale_epoch_refused",
      (e) => e.epoch.eq(e.startedEpoch).not(),
      (o) => o.valid.not(),
    ),
    l.law(
      "stale_lease_refused",
      (e) => e.lease.eq(e.startedLease).not(),
      (o) => o.valid.not(),
    ),
    l.law(
      "retired_root_refused",
      (e) => e.present.not(),
      (o) => o.valid.not(),
    ),
    l.law(
      "current_lease_accepted",
      (e) => e.present.and(e.epoch.eq(e.startedEpoch), e.lease.eq(e.startedLease)),
      (o) => o.valid,
    ),
    f.law(
      "fresh_focus_resets",
      (e) => e.fresh,
      (o) => o.reset,
    ),
    f.law(
      "changed_generation_resets",
      (e) => e.generationSame.not(),
      (o) => o.reset,
    ),
    f.law(
      "changed_focus_resets",
      (e) => e.keySame.not(),
      (o) => o.reset,
    ),
    f.law(
      "unchanged_focus_retained",
      (e) => e.fresh.not().and(e.generationSame, e.keySame),
      (o) => o.reset.not(),
    ),
    p.law(
      "fit_keeps_max_index",
      () => [],
      (o, e) => o.selected.atLeast(e.selected),
    ),
    p.law(
      "fit_selection_bounded",
      () => [],
      (o, e) => o.selected.gt(0).implies(o.cost.atMost(e.budget)),
    ),
    p.law(
      "fit_candidate_admitted",
      (e) => e.cost.atMost(e.budget).and(e.index.plus(1).gt(e.selected)),
      (o, e) => o.selected.eq(e.index.plus(1)),
    ),
    p.law(
      "fit_over_budget_never_replaces",
      (e) => e.cost.gt(e.budget),
      (o, e) => o.selected.eq(e.selected).and(o.cost.eq(e.selectedCost)),
    ),
  ];
}
