import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { binomialResidual, residualNewNames } from "../proofs/residual.ts";
import { provePolynomial } from "../scripts/prove-polynomial.ts";
import { check } from "gdp-wired/kernel";
import { Term } from "gdp-wired";

function factorial(n: number): bigint {
  let f = 1n;
  for (let k = 2; k <= n; k++) f *= BigInt(k);
  return f;
}
const choose = (n: number, k: number): bigint => factorial(n) / (factorial(k) * factorial(n - k));
type Rat = { n: bigint; d: bigint };
const q = (n: bigint, d = 1n): Rat => ({ n, d });
const add = (a: Rat, b: Rat): Rat => q(a.n * b.d + b.n * a.d, a.d * b.d);
const mul = (a: Rat, b: Rat): Rat => q(a.n * b.n, a.d * b.d);
const abs = (a: Rat): Rat => q(a.n < 0n ? -a.n : a.n, a.d);
const le = (a: Rat, b: Rat) => a.n * b.d <= b.n * a.d;
type Matrix = Rat[][];
const identity = (): Matrix => [
  [q(1n), q(0n)],
  [q(0n), q(1n)],
];
const scale = (a: Matrix, x: Rat): Matrix => a.map((row) => row.map((v) => mul(v, x)));
const plus = (a: Matrix, b: Matrix): Matrix =>
  a.map((row, i) => row.map((v, j) => add(v, b[i]![j]!)));
const times = (a: Matrix, b: Matrix): Matrix =>
  a.map((row) => b[0]!.map((_, j) => row.reduce((s, v, k) => add(s, mul(v, b[k]![j]!)), q(0n))));
const norm = (a: Matrix): Rat =>
  a.map((row) => row.reduce((s, v) => add(s, abs(v)), q(0n))).reduce((a, b) => (le(a, b) ? b : a));

describe("finite Taylor residual", () => {
  it("checks the unbounded coefficient cancellation in gdp-wired", async () => {
    // Proof search is synchronous: keep the Vitest worker free to answer RPCs.
    const script = fileURLToPath(new URL("../scripts/check-residual.ts", import.meta.url));
    const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", script], {
      timeout: 120000,
    });
    expect(stdout).toContain(
      `${residualNewNames.length} finite binomial-residual claims proved and checked`,
    );
  }, 125000);
  it("checks linear-inequality product certificates and refuses a satisfiable variant", () => {
    const a = new Term({ op: "var", name: "a" }),
      b = new Term({ op: "var", name: "b" });
    const x = new Term({ op: "var", name: "x" }),
      y = new Term({ op: "var", name: "y" });
    const target = a.mul(x).plus(b.mul(y)),
      other = a.mul(y).plus(b.mul(x));
    const goal = {
      name: "positive factors cannot have zero product",
      hyps: [a.gt(b).c, x.gt(y).c, target.eq(other).c],
    };
    const tree = provePolynomial(goal, performance.now() + 5000, undefined, {
      linearProducts: true,
      nodes: 128,
      products: 4000,
      rows: 8000,
    });
    expect(tree).toBeDefined();
    expect(check(goal, tree!)).toBe(true);
    const satisfiable = { ...goal, hyps: [a.gt(b).c, x.gt(y).c, target.eq(other.plus(1)).c] };
    expect(
      provePolynomial(satisfiable, performance.now() + 300, undefined, {
        linearProducts: true,
        nodes: 128,
        products: 4000,
        rows: 8000,
      }),
    ).toBeUndefined();
  });
  it("constructs the full signed binomial sum, not just a claimed coefficient", () => {
    for (let m = 0; m <= 12; m++) {
      const p = { order: m, cutoff: m, leftCutoff: m, seriesCutoff: m },
        run = binomialResidual.interpreter();
      let state = run.init(p);
      for (let step = 0; step < 2 * m + 3; step++)
        state = run.step(p, state, { basisP: 0, basisN: 0, basisDen: 1 });
      expect(state.scalars.phase).toBe(2);
      for (let k = 0; k <= m + 1; k++) {
        const actual =
          BigInt(state.maps.Positive!.get(k) ?? 0) - BigInt(state.maps.Negative!.get(k) ?? 0);
        let direct = 0n;
        for (let j = k; j <= m; j++)
          direct += choose(m, j) * choose(j, k) * ((j - k) % 2 ? -1n : 1n);
        expect(actual).toBe(direct);
        expect(actual).toBe(k === m ? 1n : 0n);
      }
    }
  });
  it("bounds E_N A_N - S_N by the finite 3t exponential tail in exact rational arithmetic", () => {
    const P: Matrix = [
      [q(2n, 4n), q(2n, 4n)],
      [q(1n, 4n), q(3n, 4n)],
    ];
    const Q = plus(P, scale(identity(), q(-1n)));
    for (const t of [q(0n), q(1n, 8n), q(3n, 2n), q(5n)])
      for (let N = 0; N <= 8; N++) {
        let E = q(0n),
          S = scale(identity(), q(0n)),
          A = scale(identity(), q(0n));
        let scalar = q(1n),
          pPower = identity(),
          qPower = identity();
        for (let j = 0; j <= N; j++) {
          E = add(E, scalar);
          S = plus(S, scale(pPower, scalar));
          A = plus(A, scale(qPower, scalar));
          scalar = mul(scalar, mul(t, q(1n, BigInt(j + 1))));
          pPower = times(pPower, P);
          qPower = times(qPower, Q);
        }
        const residual = norm(plus(scale(A, E), scale(S, q(-1n))));
        let bound = q(0n),
          term = q(1n);
        for (let j = 1; j <= 2 * N; j++) {
          term = mul(term, mul(t, q(3n, BigInt(j))));
          if (j > N) bound = add(bound, term);
        }
        expect(le(residual, bound)).toBe(true);
        // E_N >= 1 permits division without enlarging the residual.
        expect(E.n >= E.d).toBe(true);
        const normalized = norm(plus(A, scale(S, q(-E.d, E.n))));
        expect(le(normalized, bound)).toBe(true);
      }
  });
});
