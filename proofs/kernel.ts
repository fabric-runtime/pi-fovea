// Executable policies. Specifications live independently in laws.ts.
import { bool, fun, min, nat, when } from "gdp-wired";
export const disclosure = fun("disclosure")
  .inputs({ scope: bool, excluded: bool, seen: bool, repeat: bool, nucleus: bool })
  .returns(({ scope, excluded, seen, repeat, nucleus }) => ({
    tag: when(scope.not().or(excluded), 0, when(seen.and(repeat.and(nucleus).not()), 1, 2)),
  }));
export const counts = fun("counts")
  .inputs({ total: nat, requested: nat })
  .returns(({ total, requested }) => ({
    shown: min(total, requested),
    remaining: total.minus(min(total, requested)),
  }));
export const basis = fun("basis")
  .inputs({ have: nat, order: nat })
  .returns(({ have, order }) => ({
    tag: when(have.eq(0), 0, when(have.gt(order), 1, when(have.eq(1), 2, 3))),
    at: have,
    previous: have.minus(1),
    older: have.minus(2),
  }));
export const kernels = { disclosure, counts, basis };
