// Finite signed Cauchy products, grouped by i+j without dropping terms.
import { rule, nat, bool, record, when } from "gdp-wired";
import type { ProofGroup } from "./types.ts";
const Signed = record({ p: nat, n: nat });
export const cauchyProduct = rule("finite_cauchy_product")
  .params({ cutoff: nat })
  .inputs({ i: nat, j: nat, aP: nat, aN: nat, bP: nat, bN: nat })
  .state({ p: 0, n: 0 })
  .maps({ D: Signed.from({ p: 0, n: 0 }) })
  .flags((e) => ({ take: e.i.atMost(e.cutoff).and(e.j.atMost(e.cutoff)) }))
  .step((e) => {
    const key = e.i.plus(e.j),
      old = e.D.at(key),
      p = e.aP.mul(e.bP).plus(e.aN.mul(e.bN)),
      n = e.aP.mul(e.bN).plus(e.aN.mul(e.bP));
    return {
      p: e.p.plus(when(e.take, p, 0)),
      n: e.n.plus(when(e.take, n, 0)),
      D: e.D.set(key, { p: old.p.plus(when(e.take, p, 0)), n: old.n.plus(when(e.take, n, 0)) }),
    };
  });
const productLaws = [
  cauchyProduct.law("cauchy_product_positive_pushforward", (e) => e.D.sum((v) => v.p).eq(e.p)),
  cauchyProduct.law("cauchy_product_negative_pushforward", (e) => e.D.sum((v) => v.n).eq(e.n)),
];
export const cauchyGeometry = rule("cauchy_geometry")
  .params({ cutoff: nat, i: nat, j: nat, m: nat })
  .state({})
  .step(() => ({}));
const geometryLaws = [
  cauchyGeometry.law("cauchy_rectangle_to_diagonal", (e) =>
    e.i
      .atMost(e.cutoff)
      .and(e.j.atMost(e.cutoff), e.m.eq(e.i.plus(e.j)))
      .implies(
        e.m
          .atMost(e.cutoff.times(2))
          .and(e.i.atMost(e.cutoff), e.i.atMost(e.m), e.m.atMost(e.cutoff.plus(e.i))),
      ),
  ),
  cauchyGeometry.law("cauchy_diagonal_to_rectangle", (e) =>
    e.i
      .atMost(e.cutoff)
      .and(e.i.atMost(e.m), e.m.atMost(e.cutoff.plus(e.i)))
      .implies(
        e.m
          .minus(e.i)
          .atMost(e.cutoff)
          .and(e.i.plus(e.m.minus(e.i)).eq(e.m)),
      ),
  ),
  cauchyGeometry.law("cauchy_diagonal_inverse", (e) =>
    e.m.eq(e.i.plus(e.j)).implies(e.m.minus(e.i).eq(e.j)),
  ),
  cauchyGeometry.law("cauchy_low_diagonal_complete", (e) =>
    e.m
      .atMost(e.cutoff)
      .and(e.i.atMost(e.m))
      .implies(e.i.atMost(e.cutoff).and(e.m.minus(e.i).atMost(e.cutoff))),
  ),
];
export const productPowers = rule("cauchy_product_powers")
  .params({ base: nat })
  .inputs({ left: bool })
  .state({ i: 0, j: 0, count: 0, a: 1, b: 1, total: 1 })
  .step((e) => ({
    i: when(e.left, e.i.plus(1), e.i),
    j: when(e.left, e.j, e.j.plus(1)),
    count: e.count.plus(1),
    a: when(e.left, e.a.mul(e.base), e.a),
    b: when(e.left, e.b, e.b.mul(e.base)),
    total: e.total.mul(e.base),
  }));
const powerLaws = [
  productPowers.law("cauchy_power_index_addition", (e) => e.i.plus(e.j).eq(e.count)),
  productPowers.law("cauchy_power_multiplication", (e) => e.a.mul(e.b).eq(e.total)),
];
export const coefficientProduct = rule("cauchy_coefficient_product")
  .params({ a: nat, b: nat, m: nat, c: nat, leftDen: nat, rightDen: nat, totalDen: nat })
  .state({})
  .step(() => ({}));
const coefficientLaws = [
  coefficientProduct.law("cauchy_factorial_scaled_coefficient", (e) =>
    e.m
      .eq(e.a.mul(e.b))
      .and(e.totalDen.eq(e.c.mul(e.leftDen).mul(e.rightDen)))
      .implies(e.a.mul(e.b).mul(e.totalDen).eq(e.c.mul(e.m).mul(e.leftDen).mul(e.rightDen))),
  ),
];
export const cauchyProductProofs: ProofGroup[] = [
  {
    name: "cauchy_product_model",
    machine: cauchyProduct.withSumsOf(...productLaws).machine,
    laws: productLaws,
  },
  { name: "cauchy_geometry", machine: cauchyGeometry.machine, laws: geometryLaws },
  { name: "cauchy_power_model", machine: productPowers.machine, laws: powerLaws, polynomial: true },
  {
    name: "cauchy_coefficient_model",
    machine: coefficientProduct.machine,
    laws: coefficientLaws,
    polynomial: true,
    search: () => ({ ms: 15000, nodes: 256, products: 16000, rows: 32000, closureRounds: 1 }),
  },
];
