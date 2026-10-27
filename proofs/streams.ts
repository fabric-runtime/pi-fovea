// Executable digit machines and conservative, proof-only unbounded accumulators.
// Ghosts are never compiled: the projection laws check the bounded runtime.
import { rule, nat, upTo, when, Term, yes } from "gdp-wired";
import { ghost, product } from "gdp-wired/compose";
import type { Cond } from "gdp-wired";
import type { Law, Machine } from "gdp-wired/machine";
import type { Ghost } from "gdp-wired/compose";
import type { ProofGroup } from "./types.ts";
const U32 = 4294967296,
  term = (name: string) => new Term({ op: "var", name });
const law = (name: string, condition: Cond): Law => ({ name, holds: condition.c });
const consequence = (name: string, condition: Cond) => ({ ...law(name, condition), derived: true });
function projected<R extends { machine: Machine }>(
  name: string,
  r: R,
  laws: Law[],
  ghosts: Record<string, Ghost>,
  extra: (Law & { derived?: boolean })[],
  rank: Term,
  stepLaws: Law[] = [],
): { rule: R; baseLaws: Law[]; proofs: ProofGroup[] } {
  const machine = r.machine,
    model = ghost(machine, ghosts),
    pair = product(machine, model);
  const projections = Object.keys(machine.state).map((key) =>
    law(`${name}_projection_${key}`, term("a_" + key).eq(term("b_" + key))),
  );
  return {
    rule: r,
    baseLaws: laws,
    proofs: [
      {
        name: `${name}_model`,
        machine: model,
        laws: [...laws, ...extra.filter((l) => !l.derived)],
      },
      { name: `${name}_consequences`, from: `${name}_model`, laws: extra.filter((l) => l.derived) },
      { name: `${name}_input_safety`, from: `${name}_model`, inputs: true, laws: stepLaws },
      { name: `${name}_projection`, machine: pair, laws: projections },
      {
        name: `${name}_termination`,
        loop: {
          name: machine.name,
          params: machine.params,
          inputs: machine.inputs,
          state: machine.state,
          body: machine.step.state!,
          while: term("done").eq(0).c,
          pre: machine.pre,
          assume: machine.assume,
        },
        laws,
        rank: rank.e,
      },
    ],
  };
}
function forward(name: string, base: number, mode: "add" | "subtract" | "scale") {
  // Conditional input kinds lose their Term type in the upstream mapped type.
  const scaleInput = (value: Term | undefined): Term => {
    if (!value) throw new Error("Missing scale input");
    return value;
  };
  const r = rule(name)
    .params({ count: nat, ...(mode === "scale" ? { factor: upTo(base - 1) } : {}) })
    .inputs({
      a: upTo(base - 1),
      b: upTo(base - 1),
      ...(mode === "scale" ? { low: upTo(base - 1), high: upTo(base - 1) } : {}),
    })
    .state({ pos: 0, carry: 0, word: 0, size: 0, done: 0, error: 0 })
    .step(({ pos, carry, word, size, done, error, count, a, b, factor, low, high }) => {
      const active = done.eq(0),
        digit = pos.lt(count),
        av = when(digit, a, 0),
        bv = when(digit, b, 0);
      const total =
        mode === "scale" ? av.mul(factor!).plus(bv).plus(carry) : av.plus(bv).plus(carry);
      const borrow = av.lt(bv.plus(carry));
      const valid =
          mode === "scale" ? scaleInput(low).plus(scaleInput(high).times(base)).eq(total) : yes,
        take = active.and(valid);
      const w =
        mode === "subtract"
          ? when(borrow, av.plus(base).minus(bv.plus(carry)), av.minus(bv.plus(carry)))
          : mode === "scale"
            ? scaleInput(low)
            : when(total.atLeast(base), total.minus(base), total);
      const c =
        mode === "subtract"
          ? when(borrow, 1, 0)
          : mode === "scale"
            ? scaleInput(high)
            : when(total.atLeast(base), 1, 0);
      return {
        pos: when(take, pos.plus(1), pos),
        carry: when(take, c, carry),
        word: when(take, w, word),
        size: when(take.and(w.gt(0)), pos.plus(1), size),
        done: when(active.and(valid.not().or(pos.eq(count))), 1, done),
        error: when(active.and(valid.not()), 1, error),
      };
    });
  const laws = [
    r.law(`${name}_cursor_bound`, (e) => e.pos.atMost(e.count.plus(1))),
    r.law(`${name}_carry_bound`, (e) => e.carry.atMost(mode === "scale" ? base - 1 : 1)),
    r.law(`${name}_word_bound`, (e) => e.word.lt(base)),
    r.law(`${name}_size_bound`, (e) => e.size.atMost(e.pos)),
    r.law(`${name}_nonzero_kept`, (e) => e.word.gt(0).implies(e.size.eq(e.pos))),
    r.law(`${name}_done_exact`, (e) =>
      e.done.eq(1).iff(e.pos.eq(e.count.plus(1)).or(e.error.eq(1))),
    ),
    r.law(`${name}_done_bit`, (e) => e.done.atMost(1)),
    r.law(`${name}_error_bit`, (e) => e.error.atMost(1)),
    ...(mode === "scale" ? [] : [r.law(`${name}_never_rejects`, (e) => e.error.eq(0))]),
    ...(mode === "subtract"
      ? []
      : [
          r.law(`${name}_done_no_carry`, (e) =>
            e.done.eq(1).and(e.error.eq(0)).implies(e.carry.eq(0)),
          ),
        ]),
  ];
  const m = r.machine,
    active = new Term(m.step.state!.pos!).gt(term("pos")),
    digit = term("pos").lt(term("count"));
  const ghosts: Record<string, Ghost> = {
    power: {
      start: { op: "const", value: 1 },
      step: when(active, term("power").times(base), term("power")).e,
    },
    left: {
      start: { op: "const", value: 0 },
      step: term("left").plus(when(active.and(digit), term("a").mul(term("power")), 0)).e,
    },
    right: {
      start: { op: "const", value: 0 },
      step: term("right").plus(when(active.and(digit), term("b").mul(term("power")), 0)).e,
    },
    output: {
      start: { op: "const", value: 0 },
      step: term("output").plus(when(active, new Term(m.step.state!.word!).mul(term("power")), 0))
        .e,
    },
    space: {
      start: { op: "const", value: 0 },
      step: when(
        active,
        term("space").plus(
          new Term({ op: "const", value: base - 1 })
            .minus(new Term(m.step.state!.word!))
            .mul(term("power")),
        ),
        term("space"),
      ).e,
    },
  };
  const lhs =
    mode === "scale"
      ? term("left").mul(term("factor")).plus(term("right"))
      : term("left").plus(term("right"));
  const extra = [
    law(`${name}_positive_power`, term("power").gt(0)),
    law(`${name}_space_exact`, term("output").plus(term("space")).plus(1).eq(term("power"))),
    consequence(`${name}_output_range`, term("output").lt(term("power"))),
    mode === "subtract"
      ? law(
          `${name}_prefix_exact`,
          term("left")
            .plus(term("carry").mul(term("power")))
            .eq(term("right").plus(term("output"))),
        )
      : law(`${name}_prefix_exact`, lhs.eq(term("output").plus(term("carry").mul(term("power"))))),
    mode === "subtract"
      ? consequence(
          `${name}_completed_exact`,
          term("done")
            .eq(1)
            .and(term("carry").eq(0))
            .implies(term("left").eq(term("right").plus(term("output")))),
        )
      : consequence(
          `${name}_completed_exact`,
          term("done")
            .eq(1)
            .and(term("error").eq(0))
            .implies(lhs.eq(term("output"))),
        ),
    ...(mode === "subtract"
      ? [
          consequence(
            `${name}_underflow_exact`,
            term("done")
              .eq(1)
              .implies(
                term("carry")
                  .eq(1)
                  .iff(term("left").lt(term("right"))),
              ),
          ),
        ]
      : []),
  ];
  const intermediate =
    mode === "scale"
      ? term("a").mul(term("factor")).plus(term("b")).plus(term("carry"))
      : mode === "subtract"
        ? term("a").plus(base)
        : term("a").plus(term("b")).plus(term("carry"));
  return projected(
    name,
    r,
    laws,
    ghosts,
    extra,
    term("count")
      .plus(1)
      .minus(term("pos"))
      .times(2)
      .plus(when(term("error").eq(0), 1, 0)),
    [
      law(
        `${name}_intermediate_exact`,
        intermediate.atMost(mode === "scale" ? U32 - 1 : 2 * U32 - 1),
      ),
      law(`${name}_extent_monotonic`, new Term(m.step.state!.size!).atLeast(term("size"))),
    ],
  );
}
function division() {
  const name = "divide16",
    base = 65536;
  const r = rule(name)
    .params({ count: nat, divisor: upTo(U32 - 1) })
    .pre((e) => e.divisor.gt(0))
    .inputs({ digit: upTo(base - 1), quotient: upTo(base - 1), remainder: upTo(U32 - 1) })
    .state({ pos: 0, carry: 0, word: 0, done: (e) => when(e.count.eq(0), 1, 0), error: 0 })
    .step(({ pos, carry, word, done, error, count, divisor, digit, quotient, remainder }) => {
      const active = done.eq(0),
        valid = carry
          .times(base)
          .plus(digit)
          .eq(quotient.mul(divisor).plus(remainder))
          .and(remainder.lt(divisor)),
        take = active.and(valid);
      return {
        pos: when(take, pos.plus(1), pos),
        carry: when(take, remainder, carry),
        word: when(take, quotient, word),
        error: when(active.and(valid.not()), 1, error),
        done: when(active.and(valid.not().or(pos.plus(1).eq(count))), 1, done),
      };
    });
  const laws = [
    r.law(`${name}_cursor_bound`, (e) => e.pos.atMost(e.count)),
    r.law(`${name}_remainder_bound`, (e) => e.carry.lt(e.divisor)),
    r.law(`${name}_word_bound`, (e) => e.word.lt(base)),
    r.law(`${name}_error_bit`, (e) => e.error.atMost(1)),
    r.law(`${name}_done_bit`, (e) => e.done.atMost(1)),
    r.law(`${name}_done_exact`, (e) => e.done.eq(1).iff(e.pos.eq(e.count).or(e.error.eq(1)))),
  ];
  const active = term("done").eq(0),
    valid = term("carry")
      .times(base)
      .plus(term("digit"))
      .eq(term("quotient").mul(term("divisor")).plus(term("remainder")))
      .and(term("remainder").lt(term("divisor"))),
    take = active.and(valid);
  const ghosts: Record<string, Ghost> = {
    left: {
      start: { op: "const", value: 0 },
      step: when(take, term("left").times(base).plus(term("digit")), term("left")).e,
    },
    output: {
      start: { op: "const", value: 0 },
      step: when(take, term("output").times(base).plus(term("quotient")), term("output")).e,
    },
  };
  const extra = [
    law(
      `${name}_prefix_exact`,
      term("left").eq(term("output").mul(term("divisor")).plus(term("carry"))),
    ),
    law(
      `${name}_completed_exact`,
      term("done")
        .eq(1)
        .and(term("error").eq(0))
        .implies(term("left").eq(term("output").mul(term("divisor")).plus(term("carry")))),
    ),
  ];
  return projected(
    name,
    r,
    laws,
    ghosts,
    extra,
    term("count")
      .minus(term("pos"))
      .times(2)
      .plus(when(term("error").eq(0), 1, 0)),
    [
      law(
        `${name}_numerator_exact`,
        term("carry").times(base).plus(term("digit")).atMost(281474976710655),
      ),
      law(
        `${name}_witness_exact`,
        term("quotient").mul(term("divisor")).plus(term("remainder")).atMost(281474976710655),
      ),
    ],
  );
}
function comparison() {
  const name = "compare32",
    r = rule(name)
      .params({ count: nat })
      .inputs({ a: upTo(U32 - 1), b: upTo(U32 - 1) })
      .state({ pos: 0, relation: 0, done: (e) => when(e.count.eq(0), 1, 0) })
      .step(({ pos, relation, done, count, a, b }) => ({
        pos: when(done.eq(0), pos.plus(1), pos),
        relation: when(
          done.eq(0).and(relation.eq(0)),
          when(a.lt(b), 1, when(a.gt(b), 2, 0)),
          relation,
        ),
        done: when(pos.plus(1).eq(count), 1, done),
      }));
  const laws = [
    r.law(`${name}_cursor_bound`, (e) => e.pos.atMost(e.count)),
    r.law(`${name}_relation_bound`, (e) => e.relation.atMost(2)),
    r.law(`${name}_done_bit`, (e) => e.done.atMost(1)),
    r.law(`${name}_done_exact`, (e) => e.done.eq(1).iff(e.pos.eq(e.count))),
  ];
  const active = term("done").eq(0),
    ghosts: Record<string, Ghost> = {
      left: {
        start: { op: "const", value: 0 },
        step: when(active, term("left").times(U32).plus(term("a")), term("left")).e,
      },
      right: {
        start: { op: "const", value: 0 },
        step: when(active, term("right").times(U32).plus(term("b")), term("right")).e,
      },
    };
  const extra = [
    law(
      `${name}_equal_exact`,
      term("relation")
        .eq(0)
        .iff(term("left").eq(term("right"))),
    ),
    law(
      `${name}_less_exact`,
      term("relation")
        .eq(1)
        .iff(term("left").lt(term("right"))),
    ),
    law(
      `${name}_greater_exact`,
      term("relation")
        .eq(2)
        .iff(term("left").gt(term("right"))),
    ),
  ];
  return projected(name, r, laws, ghosts, extra, term("count").minus(term("pos")));
}

export const streams = {
  add32: forward("add32", U32, "add"),
  subtract32: forward("subtract32", U32, "subtract"),
  multiply16: forward("multiply16", 65536, "scale"),
  divide16: division(),
  compare32: comparison(),
};
export const streamProofs = Object.values(streams).flatMap((s) => s.proofs);
export const streamLawNames = streamProofs.flatMap((p) =>
  p.loop ? [p.name] : p.laws.map((l) => l.name),
);
