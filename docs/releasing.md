# Releasing the extension and standalone CLI

The root `package.json` remains **`pi-fovea`**, including its existing Pi entry
points and legacy `fovea` bin. **`@monotykamary/fovea`** is a separate CLI-only
distribution generated from the same source, version, and `dist/cli.mjs` bundle.
There is no second version to maintain and no extension build step.

## How a release goes out

Releases are published only by
[`.github/workflows/publish.yml`](../.github/workflows/publish.yml), using npm
Trusted Publishing (OIDC). No npm token is stored locally or in the
repository, so nobody runs `npm login`, `npm publish`, or `bun publish` by hand.

1. Land the change on `main` after its change-scoped checks pass
   (`bun run check:fast`; see `AGENTS.md`).
2. Bump `"version"` in the root `package.json` in a separate
   `chore(release): X.Y.Z` commit. Both packages use that version.
3. Push the commit to `main`, and tag it `vX.Y.Z` as earlier releases are.

A push to `main` that changes `package.json` starts the workflow. It publishes
each of `@monotykamary/fovea@X.Y.Z` and `pi-fovea@X.Y.Z` that npm does not
have yet; when both exist, the push does nothing. For a version it publishes, the
workflow:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run pack:cli                         # writes dist/fovea-cli.tgz
bun run check:package:cli dist/fovea-cli.tgz
bun pm pack --filename dist/pi-fovea.tgz --quiet
bun run check:package dist/pi-fovea.tgz
```

then uploads those **same checked tarballs**, CLI first, with
`npm publish <tarball> --access public --provenance`. Bun installs and packs
exactly as `bun publish` would; npm uploads because only the npm CLI supports
trusted publishing.

The trust relationship was registered once per package:

```sh
npm trust github @monotykamary/fovea --repo fabric-runtime/pi-fovea --file publish.yml --allow-publish
npm trust github pi-fovea --repo fabric-runtime/pi-fovea --file publish.yml --allow-publish
```

Renaming the workflow file or moving the repository breaks publishing until
the trust is registered again.

## Optional local preflight

To check the archives before pushing the release commit, run the same packing
and checks locally (with development dependencies, including pinned
gdp-wired, installed):

```sh
bun run check:fast
bun run pack:cli
bun run check:package:cli dist/fovea-cli.tgz
bun pm pack --filename dist/pi-fovea.tgz --quiet
bun run check:package dist/pi-fovea.tgz
```

Packing is deterministic: the same commit produces byte-identical archives, so
a local preflight checks the same bytes CI will publish. Local archives are for
checking only; CI publishes its own.

`pack:cli` runs the same proof and fresh-bundle gate as the root `prepack` hook,
then stages an allowlisted package outside the checkout. It does not rename or
rewrite the root manifest. The CLI manifest has no Pi registration, Pi peers,
TypeScript loader, or install/build hooks. It retains the optional ast-grep
parser dependency, licenses, and auditable proof receipt inputs/outputs.
`docs/cli.md` becomes its npm README.

`check:package:cli` without an archive builds and checks a temporary tarball.
With an archive, it checks that exact artifact without rebuilding it. Checks
cover metadata, proof hashes, license files, compiler-free execution, and an
offline npm global install in a disposable prefix (optional parsers omitted).
Neither check publishes anything. Normal CI, packaging and publication require
gdp-wired checks, not Lean or a fresh Lean receipt. The independent Lean audit
is available through the manually triggered checks workflow. Both archives
retain the optional audit sources and historical coverage inventory; neither
installs Lean or mathlib.

## Retries and dry runs

Run **Publish** from the Actions tab (`workflow_dispatch`) to retry a failed
release. It skips any package version npm already has, so a rerun after a
partial release publishes only the missing package. Tick `dry_run` to build,
check, and pack without publishing.

The two packages are independent registry publications, not an atomic release.
Treat registry advisories as pending: "Your package is being processed and may
take a few minutes to become available" (during which `npm view` still shows
the previous `latest`), a staged-version 409, or an empty `/-/stage` response.
Wait for them to complete; do not bump the version, retag, or rerun in
response. Each published version carries a provenance statement linking it to
the workflow run.

After the first public CLI release, users can run:

```sh
npm install -g @monotykamary/fovea
fovea sketch /path/to/repo 900
```

The command stays `fovea`. Users migrating from a global `pi-fovea` install
should uninstall that global package first; both own the same executable.
`pi install npm:pi-fovea` is unchanged and can coexist with the standalone CLI.
