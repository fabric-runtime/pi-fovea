import type { C, E, Law, Machine } from "gdp-wired/machine";
export interface Frame {
  v: Record<string, bigint>;
  maps: Record<string, Map<bigint, bigint>>;
  flags: Record<string, boolean>;
}
function evaluate(e: E, f: Frame): bigint {
  switch (e.op) {
    case "const":
      return BigInt(e.value);
    case "var": {
      const v = f.v[e.name];
      if (v === undefined) throw new Error(`Unknown ${e.name}`);
      return v;
    }
    case "get":
      return f.maps[e.map]!.get(evaluate(e.key, f)) ?? 0n;
    case "add":
      return evaluate(e.a, f) + evaluate(e.b, f);
    case "sub": {
      const v = evaluate(e.a, f) - evaluate(e.b, f);
      return v < 0n ? 0n : v;
    }
    case "mul":
      return BigInt(e.k) * evaluate(e.a, f);
    case "prod":
      return evaluate(e.a, f) * evaluate(e.b, f);
    case "if":
      return evaluate(condition(e.c, f) ? e.then : e.else, f);
    default:
      throw new Error(`Unhandled ${e.op}`);
  }
}
export function condition(c: C, f: Frame): boolean {
  switch (c.op) {
    case "=":
      return evaluate(c.a, f) === evaluate(c.b, f);
    case "<":
      return evaluate(c.a, f) < evaluate(c.b, f);
    case "<=":
      return evaluate(c.a, f) <= evaluate(c.b, f);
    case "and":
      return c.xs.every((x) => condition(x, f));
    case "or":
      return c.xs.some((x) => condition(x, f));
    case "not":
      return !condition(c.x, f);
    case "flag": {
      const value = f.flags[c.name];
      if (value === undefined) throw new Error(`Unknown flag ${c.name}`);
      return value;
    }
    default:
      throw new Error(`Unhandled ${c.op}`);
  }
}
export function exactMachine(model: Machine, laws: Law[]) {
  function sums(f: Frame) {
    const keys = new Set(Object.values(f.maps).flatMap((m) => [...m.keys()]));
    for (const [name, s] of Object.entries(model.sums ?? {}))
      f.v[name] = [...keys].reduce(
        (n, k) => n + evaluate(s.term, { ...f, v: { ...f.v, [s.key]: k } }),
        0n,
      );
    return f;
  }
  function initial(params: Record<string, bigint>): Frame {
    const f: Frame = {
      v: { ...params },
      maps: Object.fromEntries(Object.keys(model.maps ?? {}).map((k) => [k, new Map()])),
      flags: {},
    };
    if (model.pre && !condition(model.pre, f)) throw new Error("Invalid model parameters");
    for (const [k, e] of Object.entries(model.state)) f.v[k] = evaluate(e, f);
    return sums(f);
  }
  function advance(f: Frame, input: Record<string, bigint>): Frame {
    const before = sums({ ...f, v: { ...f.v, ...input }, flags: {} });
    if (model.assume && !condition(model.assume, before)) throw new Error("Invalid model input");
    for (const [name, c] of Object.entries(model.step.flags ?? {}))
      before.flags[name] = condition(c, before);
    const maps = Object.fromEntries(Object.entries(f.maps).map(([k, v]) => [k, new Map(v)]));
    for (const [name, w] of Object.entries(model.step.maps ?? {})) {
      if ("each" in w) throw new Error("Expected point updates");
      maps[name]!.set(evaluate(w.key, before), evaluate(w.value, before));
    }
    const after = sums({
      v: {
        ...Object.fromEntries(model.params.map((k) => [k, f.v[k]!])),
        ...Object.fromEntries(
          Object.entries(model.step.state ?? {}).map(([k, e]) => [k, evaluate(e, before)]),
        ),
      },
      maps,
      flags: {},
    });
    const keys = new Set([
      0n,
      1n,
      2n,
      65539n,
      ...Object.values(maps).flatMap((m) => [...m.keys()]),
    ]);
    for (const l of laws)
      for (const k of l.forall ? keys : [0n])
        if (
          !condition(l.holds, {
            ...after,
            v: { ...after.v, ...(l.forall ? { [l.forall]: k } : {}) },
          })
        )
          throw new Error(`Invariant failed: ${l.name}`);
    return after;
  }
  return { initial, advance };
}
