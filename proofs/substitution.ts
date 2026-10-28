// Capture-avoiding, total substitution for the kernel's existing expression AST.
// This does not prove a formula: every substituted claim is checked again.
import type { E, C } from "gdp-wired/machine";
export function bindExpression(
  e: E,
  vars: Record<string, E>,
  bound: ReadonlySet<string> = new Set(),
): E {
  switch (e.op) {
    case "var": {
      if (bound.has(e.name)) return e;
      const result = vars[e.name];
      if (!result) throw new Error(`Unbound proof variable ${e.name}`);
      return result;
    }
    case "const":
      return e;
    case "add":
    case "sub":
    case "min":
    case "max":
    case "prod":
      return { ...e, a: bindExpression(e.a, vars, bound), b: bindExpression(e.b, vars, bound) };
    case "mul":
      return { ...e, a: bindExpression(e.a, vars, bound) };
    case "get":
      return { ...e, key: bindExpression(e.key, vars, bound) };
    case "if":
      return {
        ...e,
        c: bindCondition(e.c, vars, bound),
        then: bindExpression(e.then, vars, bound),
        else: bindExpression(e.else, vars, bound),
      };
  }
}
export function bindCondition(
  c: C,
  vars: Record<string, E>,
  bound: ReadonlySet<string> = new Set(),
): C {
  switch (c.op) {
    case "<":
    case "<=":
    case "=":
      return { ...c, a: bindExpression(c.a, vars, bound), b: bindExpression(c.b, vars, bound) };
    case "and":
    case "or":
      return { ...c, xs: c.xs.map((x) => bindCondition(x, vars, bound)) };
    case "not":
      return { ...c, x: bindCondition(c.x, vars, bound) };
    case "all": {
      const inner = new Set([...bound, c.key, ...(c.keys ?? [])]);
      return {
        ...c,
        c: bindCondition(c.c, vars, inner),
        ...(c.witness ? { witness: bindExpression(c.witness, vars, bound) } : {}),
      };
    }
    case "flag":
      throw new Error(`Unbound proof flag ${c.name}`);
  }
}
