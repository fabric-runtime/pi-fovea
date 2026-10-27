# AGENTS.md

## Golden rule: check the change, not the suite

Finish a change with the change-scoped check:

```sh
bun run check:fast
```

gdp-wired laws and generated-kernel parity, typecheck, then only the tests your
working tree touches. Do not replace this selection with the full suite.
There is **no extension build step**: pi loads the extension
from `src/` via jiti, so green checks on the files you touched mean the change
is live.

## Startup: lazy execution must also mean lazy imports

Warm jiti caches remove transpilation, not V8 module compilation. The extension
previously deferred graph work while still statically importing `ops`, `state`,
`sync`, and their entire analysis graph. Keep registration, root bookkeeping,
and idle lifecycle hooks lightweight; `core/extension-runtime.ts` loads only
when an operation actually needs analysis. Cleanup must not import an unused
runtime. Preserve reset/shutdown behavior after activation and coalesce concurrent
first loads. Type-only dependencies must use `import type`.

Do not move the cost into `session_start`, an idle prompt, an immediately invoked
async initializer, or a zero-delay background import. Avoid broad barrel imports
from startup code. Even catalog or schema-builder imports have transitive costs;
native ESM can bypass Pi's virtual host modules and load another package copy.

`tests/startup.test.ts` checks the complete static graph, byte budget, idle
lifecycle, first use, and activated cleanup. Keep it alongside the extension
behavior tests when changing imports; do not raise the budget to hide growth.
Measure fresh-process imports with warm filesystem caches, never repeated imports
in one process. From the sibling Fabric checkout, run
`bun run benchmark:startup ../pi-fovea`. Timings are observations; deterministic
graph and behavior checks are the regression gate. Development remains buildless.

## Checks are incremental, never a full sweep

Never run the whole suite as a gate. Verify the files a change touches:

```sh
bun run check:fast                             # typecheck + affected tests
bun run test:changed                           # dirty src/tests files vs HEAD
bun run test:affected                          # CI mode: $PI_TEST_BASE vs HEAD
bun run test:smoke                             # curated pipeline floor, seconds
bun run test:related -- src/core/build.ts      # tests importing given files
bunx vitest run tests/extract.test.ts          # one suite, by path
bun run typecheck                              # whole-program types, seconds
```

`scripts/test-affected.mjs` backs the first three. It feeds changed source
files to `vitest related`, runs changed `tests/**/*.test.ts` directly, and drops
deleted paths. That selection avoids the vitest `--changed` pitfall where a
dirty `package.json` forces the entire suite to run. An unreadable git state
fails loudly. Nothing falls back to the full suite, and there is no `bun run
check` or `bun run test` script: those aggregates are gone on purpose. When you
deliberately want everything, `bunx vitest run` is the whole suite.

CI selects by range: the workflow passes the pull-request base or the replaced
push tip as `PI_TEST_BASE` and compares it to `HEAD` as a three-dot diff. A
docs-only push selects nothing, and the curated `test:smoke` floor then carries
the signal. `bun run lint:dead` (knip) stays in CI because it costs under a
second. There is no cross-platform matrix: nothing in `src/` or `tests/` branches
on `process.platform`.

Publishing runs `prepack` (`check:proofs` then `build:cli`), never the suite.
The CLI build checks the generated artifact receipt without loading the prover and
rejects unbundled dependencies other than Node built-ins. Before a release, run
`bun run check:package`: it checks a real Bun tarball outside the checkout,
including receipt hashes, entry points, licenses and compiler-free execution.
`bun run check:package path/to/package.tgz` checks an existing archive; publish
that same checked tarball with `bun publish path/to/package.tgz`.

## Executed gdp-wired kernels

`proofs/kernel.mjs` and `proofs/controls.mjs` are the executable policies;
`proofs/laws.mjs` supplies independent specifications. `proofs/ledger.json` lists
all required laws. Never weaken a law to make a proof pass. After changing proof
sources, the ABI, bridge, or adapters: `bun run proofs:generate`, review generated
JS, then `bun run check:fast`. Do not hand-edit `src/verified/generated/`.
gdp-wired is pinned to 0.30.1. Require proven && checked; unproved foreign facts,
effectful proof imports, and escaping local imports are forbidden. Installed
Fovea loads only generated JavaScript, never the prover. See `docs/proofs.md`
for executed policies, exact scalar certificates, and remaining numerical gaps.

## Generated arithmetic streams

`proofs/streams.mjs` defines five executable digit machines; `scripts/check-streams.mjs`
checks 98 claims including unbounded prefix reconstruction, termination, intermediate
bounds and ghost erasure. `bun run check:streams` is a quick local check and needs
no Lean. Do not compile ghost state or pass unproved premises to corollary checks.
Runtime codecs must enforce parameter bounds; generated steps enforce input kinds.
The generated module is `src/verified/generated/streams.js`. Keep host packing and
outer traversal obligations separate; this is not a proof of the entire evaluator.

## Constructive scalar-series foundation

`proofs/series.mjs` proves 23 natural/rational claims, including a uniform
all-future-prefix Cauchy bound and an explicit modulus. `bun run check:series`
needs no Lean. These are mathematical model proofs, not yet a proof of the
complete matrix-exponential evaluator; retain the certificate assumptions.
`scripts/prove-polynomial.mjs` is untrusted search. Every returned tree must pass
`gdp-wired/kernel.check`; do not turn its products, cuts or failed searches into
assumed facts. Support lists may only remove hypotheses. Derived premises must
already be checked in the same state context; never import input-dependent
claims as unconditional state facts.

## Independent Lean numerical models

`proofs/lean` contains 28 model theorems, not proofs of the production TypeScript
loops. Do not claim runtime correspondence or remove certificate assumptions
on the strength of these models. `scripts/check-lean.mjs` pins Lean/mathlib,
audits every required theorem's axioms, and rejects proof escapes.

After changing a Lean input, use the pinned checkout described in
`docs/proofs.md`: `FOVEA_MATHLIB_ROOT=... bun run check:lean --write`, then
`bun run proofs:generate` and `bun run check:fast`. Run heavy checks on Modal.
Normal checks/prepack verify the Lean receipt without loading a compiler;
CI/releases additionally run the full proof check. Keep the required-theorem
inventory and standard-axiom allowlist strict, and keep mathlib/cache artifacts
outside the checkout and published packages.

## Cache invalidation

Two caches live in \`$TMPDIR\`: per-file extraction facts (\`pi-fovea-*.json\`,
keyed by content sha1 + \`CACHE_VERSION\` + rules hash) and co-change pairs
(\`pi-fovea-cochange-*.json\`, keyed by HEAD + tracked-file set).

Facts (symbols/imports/calls/literals per file) are content-hash cached in
`$TMPDIR/pi-fovea-*.json`. If you change *extractor semantics* (what a parser
emits for unchanged file content), bump `CACHE_VERSION` in
`src/core/build.ts` or stale test facts linger.

## Conventions

- Vitest covers: diffusion core vs an independent scaled-Taylor reference
  (never compare Chebyshev to raw Taylor at large t — catastrophic
  cancellation; that's why the reference scales-and-squares), extractors and
  joins on `tests/fixtures/mini` (cross-language monorepo: Go server + TS
  client + OpenAPI + Python worker), budget conformance, delta contract.
- Budget assertions use `tokens <= B` exactly; the renderer's prefix-fit loop
  must stay monotonic in the candidate prefix.
- Conventional commits: `feat(scope): ...`, `fix(scope): ...`.
- Host Pi APIs and `typebox` belong in wildcard peerDependencies, never runtime
  dependencies or bundles; exact Pi/TypeBox test pins and heavy deps belong in devDependencies.
- The published `fovea` bin is a bundle: `prepack` → `bun run build:cli`
  (esbuild → `dist/cli.mjs`), so `npm i -g pi-fovea` needs neither tsx nor
  runtime deps. `check:fast` never touches `dist/` — dev stays buildless.
