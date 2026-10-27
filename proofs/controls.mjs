import { bool, fun, min, nat, when } from 'gdp-wired';
export const semaphore = fun('semaphore')
  .inputs({active:nat,waiting:nat,limit:nat,release:bool})
  .assume(e=>e.limit.atLeast(1).and(e.active.atMost(e.limit),e.release.implies(e.active.gt(0))))
  .returns(({active,waiting,limit,release})=>({
    active:when(release,when(waiting.gt(0),active,active.minus(1)),when(active.lt(limit),active.plus(1),active)),
    waiting:when(release,waiting.minus(1),when(active.lt(limit),waiting,waiting.plus(1))),
    admit:release.not().and(active.lt(limit)), wake:release.and(waiting.gt(0)),
  }));
export const capacity = fun('capacity').inputs({count:nat,limit:nat})
  .assume(e=>e.limit.atLeast(1))
  .returns(({count,limit})=>({keep:min(count,limit.minus(1)),evict:count.atLeast(limit)}));
export const lease = fun('lease').inputs({epoch:nat,startedEpoch:nat,lease:nat,startedLease:nat,present:bool})
  .returns(e=>({valid:e.present.and(e.epoch.eq(e.startedEpoch),e.lease.eq(e.startedLease))}));
export const focus = fun('focus').inputs({fresh:bool,generationSame:bool,keySame:bool})
  .returns(e=>({reset:e.fresh.or(e.generationSame.not(),e.keySame.not())}));
// The host scans EVERY prefix's actual rendered cost. No monotonic-cost premise.
export const fit = fun('fit').inputs({budget:nat,index:nat,cost:nat,selected:nat,selectedCost:nat})
  .assume(e=>e.selected.gt(0).implies(e.selectedCost.atMost(e.budget)))
  .returns(e=>({
    selected:when(e.cost.atMost(e.budget).and(e.index.plus(1).gt(e.selected)),e.index.plus(1),e.selected),
    cost:when(e.cost.atMost(e.budget).and(e.index.plus(1).gt(e.selected)),e.cost,e.selectedCost),
  }));
export const controls={semaphore,capacity,lease,focus,fit};
