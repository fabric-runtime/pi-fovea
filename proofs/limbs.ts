// Audited primitive contracts plus production rounding/work decisions.
// Whole digit streams now execute from streams.ts. No wraparound arithmetic.
import { bool, fun, upTo, when } from "gdp-wired";
const U32 = upTo(4294967295),
  U16 = upTo(65535),
  Bit = upTo(1);
export const addWord = fun("addWord")
  .inputs({ a: U32, b: U32, carry: Bit })
  .returns(({ a, b, carry }) => ({
    word: when(
      a.plus(b).plus(carry).atLeast(4294967296),
      a.plus(b).plus(carry).minus(4294967296),
      a.plus(b).plus(carry),
    ),
    carry: when(a.plus(b).plus(carry).atLeast(4294967296), 1, 0),
  }));
export const subtractWord = fun("subtractWord")
  .inputs({ a: U32, b: U32, borrow: Bit })
  .returns(({ a, b, borrow }) => ({
    word: when(
      a.lt(b.plus(borrow)),
      a.plus(4294967296).minus(b.plus(borrow)),
      a.minus(b.plus(borrow)),
    ),
    borrow: when(a.lt(b.plus(borrow)), 1, 0),
  }));
export const multiplyCell = fun("multiplyCell")
  .inputs({ a: U16, b: U16, cell: U16, carry: U16 })
  .returns(({ a, b, cell, carry }) => ({ total: a.mul(b).plus(cell).plus(carry) }));
// JS divides an exactly representable <=48-bit numerator. Its result is
// accepted only if these generated equations certify the quotient/remainder.
export const divisionCell = fun("divisionCell")
  .inputs({ previous: U32, digit: U16, divisor: U32, quotient: U16, remainder: U32 })
  .assume((e) => e.divisor.gt(0).and(e.previous.lt(e.divisor)))
  .returns((e) => ({
    valid: e.previous
      .times(65536)
      .plus(e.digit)
      .eq(e.quotient.mul(e.divisor).plus(e.remainder))
      .and(e.remainder.lt(e.divisor)),
  }));
// mode: 0 floor, 1 ceil, 2 nearest-even. Guard is the first discarded bit.
export const rounding = fun("rounding")
  .inputs({ mode: upTo(2), guard: bool, sticky: bool, odd: bool })
  .returns(({ mode, guard, sticky, odd }) => ({
    increment: when(
      mode
        .eq(1)
        .and(guard.or(sticky))
        .or(mode.eq(2).and(guard, sticky.or(odd))),
      1,
      0,
    ),
  }));
export const work = fun("numericWork")
  .inputs({ used: upTo(1000000), amount: upTo(2000000), limit: upTo(1000000) })
  .assume((e) => e.used.atMost(e.limit))
  .returns(({ used, amount, limit }) => ({
    admit: used.plus(amount).atMost(limit),
    used: when(used.plus(amount).atMost(limit), used.plus(amount), used),
  }));
// One actual CSR edge transition: bounded cursor advancement and direction.
export const sparseEdge = fun("sparseEdge")
  .inputs({ row: U32, nodes: U32, at: U32, end: U32, total: U32, to: U32, forward: bool })
  .returns((e) => {
    const admit = e.row.lt(e.nodes).and(e.to.lt(e.nodes), e.at.lt(e.end), e.end.atMost(e.total));
    return {
      admit,
      next: when(admit, e.at.plus(1), e.at),
      origin: when(e.forward, e.row, e.to),
      destination: when(e.forward, e.to, e.row),
    };
  });
export const limbs = {
  addWord,
  subtractWord,
  multiplyCell,
  divisionCell,
  rounding,
  work,
  sparseEdge,
};
export function limbLaws({
  addWord: a,
  subtractWord: s,
  multiplyCell: m,
  divisionCell: d,
  rounding: r,
  work: w,
  sparseEdge: edge,
}: typeof limbs) {
  return [
    edge.law(
      "sparse_edge_advances",
      () => [],
      (o, e) => o.admit.implies(o.next.eq(e.at.plus(1))),
    ),
    edge.law(
      "sparse_edge_cursor_bounded",
      () => [],
      (o, e) => o.admit.implies(o.next.atMost(e.end).and(o.next.atMost(e.total))),
    ),
    edge.law(
      "sparse_edge_coordinates_bounded",
      () => [],
      (o, e) => o.admit.implies(o.origin.lt(e.nodes).and(o.destination.lt(e.nodes))),
    ),
    edge.law(
      "sparse_edge_refusal_unchanged",
      () => [],
      (o, e) => o.admit.not().implies(o.next.eq(e.at)),
    ),
    edge.law(
      "sparse_edge_forward_direction",
      (e) => e.forward,
      (o, e) => o.origin.eq(e.row).and(o.destination.eq(e.to)),
    ),
    edge.law(
      "sparse_edge_focus_direction",
      (e) => e.forward.not(),
      (o, e) => o.origin.eq(e.to).and(o.destination.eq(e.row)),
    ),
    edge.law(
      "sparse_edge_valid_admitted",
      (e) => e.row.lt(e.nodes).and(e.to.lt(e.nodes), e.at.lt(e.end), e.end.atMost(e.total)),
      (o) => o.admit,
    ),
    w.law(
      "numeric_work_never_exceeds_limit",
      () => [],
      (o, e) => o.used.atMost(e.limit),
    ),
    w.law(
      "numeric_work_admitted_exactly",
      (e) => e.used.plus(e.amount).atMost(e.limit),
      (o, e) => o.admit.and(o.used.eq(e.used.plus(e.amount))),
    ),
    w.law(
      "numeric_work_refused_unchanged",
      (e) => e.used.plus(e.amount).gt(e.limit),
      (o, e) => o.admit.not().and(o.used.eq(e.used)),
    ),
    r.law(
      "rounding_increment_is_bit",
      () => [],
      (o) => o.increment.atMost(1),
    ),
    r.law(
      "rounding_floor_never_increments",
      (e) => e.mode.eq(0),
      (o) => o.increment.eq(0),
    ),
    r.law(
      "rounding_exact_never_increments",
      (e) => e.guard.not().and(e.sticky.not()),
      (o) => o.increment.eq(0),
    ),
    r.law(
      "rounding_ceil_discards_up",
      (e) => e.mode.eq(1).and(e.guard.or(e.sticky)),
      (o) => o.increment.eq(1),
    ),
    r.law(
      "rounding_nearest_below_half",
      (e) => e.mode.eq(2).and(e.guard.not()),
      (o) => o.increment.eq(0),
    ),
    r.law(
      "rounding_nearest_above_half",
      (e) => e.mode.eq(2).and(e.guard, e.sticky),
      (o) => o.increment.eq(1),
    ),
    r.law(
      "rounding_nearest_ties_even",
      (e) => e.mode.eq(2).and(e.guard, e.sticky.not()),
      (o, e) => o.increment.eq(when(e.odd, 1, 0)),
    ),
    a.law(
      "u32_add_reconstructs",
      () => [],
      (o, e) => o.word.plus(o.carry.times(4294967296)).eq(e.a.plus(e.b).plus(e.carry)),
    ),
    a.law(
      "u32_add_digit_bounded",
      () => [],
      (o) => o.word.atMost(4294967295),
    ),
    a.law(
      "u32_add_carry_bounded",
      () => [],
      (o) => o.carry.atMost(1),
    ),
    s.law(
      "u32_subtract_reconstructs",
      () => [],
      (o, e) =>
        o.word
          .plus(e.b)
          .plus(e.borrow)
          .eq(e.a.plus(o.borrow.times(4294967296))),
    ),
    s.law(
      "u32_subtract_digit_bounded",
      () => [],
      (o) => o.word.atMost(4294967295),
    ),
    s.law(
      "u32_subtract_borrow_bounded",
      () => [],
      (o) => o.borrow.atMost(1),
    ),
    m.law(
      "u16_product_cell_exact",
      () => [],
      (o, e) => o.total.eq(e.a.mul(e.b).plus(e.cell).plus(e.carry)),
    ),
    m.law(
      "u16_product_cell_fits_u32",
      () => [],
      (o) => o.total.atMost(4294967295),
    ),
    d.law(
      "u16_division_numerator_exact",
      () => [],
      (_, e) => e.previous.times(65536).plus(e.digit).atMost(281474976710655),
    ),
    d.law(
      "u16_division_reconstructs",
      () => [],
      (o, e) =>
        o.valid.implies(
          e.previous.times(65536).plus(e.digit).eq(e.quotient.mul(e.divisor).plus(e.remainder)),
        ),
    ),
    d.law(
      "u16_division_remainder_bounded",
      () => [],
      (o, e) => o.valid.implies(e.remainder.lt(e.divisor)),
    ),
  ];
}
