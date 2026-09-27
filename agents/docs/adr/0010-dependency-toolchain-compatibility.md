# ADR-0010: Dependency toolchain compatibility

- Status: Accepted
- Date: 2026-09-27
- Owners: project maintainers
- Scope: dependency update tooling and validation; no runtime protocol changes
- Related: [PR #173](https://github.com/minori-live/heron/pull/173)

## Context

The grouped dependency update exposes compatibility boundaries that independent
version bumps cannot preserve. TypeScript 7 no longer exports the JavaScript
compiler API used by our UI boundary audit, Vue type checker, and ESLint. The
stable Storybook 10 test addon supports Vitest 4. Generated Windows COM interfaces
and legacy minimatch consumers also depend on specific dependency API families.

## Decision

Use TypeScript 7 for plain `tsc` checks through the `@typescript/native` npm alias.
Alias `typescript` to Microsoft's `@typescript/typescript6` compatibility package
for programmatic compiler access, `vue-tsc`, and typed ESLint. This follows
[Microsoft's supported side-by-side setup](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6-0).
Declare the native compiler in every workspace that invokes `tsc` directly.

Use Vitest 5 for application and shared-package tests and benchmarks. Keep
Storybook's Vitest and Playwright provider together in the named `storybook`
catalog on Vitest 4 while stable Storybook requires it. Preserve all existing
test, coverage, type-checking, and lint gates.

Keep the direct `windows-core` dependency in the same compatible release family
as `windows`, because `#[implement]` expands to that crate's COM traits. Keep
the minimatch 3 override on brace-expansion 1, whose CommonJS export is callable.
Restrict these specific Renovate edges so automatic updates cannot recreate the
incompatible combinations. Other consumers retain their newer dependency versions.

Lock pnpm to 12.7.0 to include the [Unix process cleanup fix](https://github.com/pnpm/pnpm/pull/15564).
In pnpm 12.6.0, a non-interactive child runs in a separate process group and can
survive Playwright's shutdown signal. Storybook then keeps its output pipes open,
leaving the Linux design-system test command waiting after its tests finish.

## Alternatives rejected

- Reverting the entire update discards compatible upgrades and the native
  TypeScript compiler without addressing the dependency boundaries.
- Ignoring peer requirements, replacing type checks with transpilation, or
  disabling tests would hide failures instead of preserving validation.
- Adopting prerelease Storybook 11 solely for Vitest 5 adds an unrelated
  foundational migration when the stable test integration remains supported.

## Consequences

Development installs carry both compiler implementations and both Vitest major
versions. Catalogs and package-local declarations make each consumer explicit;
the release application does not acquire these development dependencies.

## Verification

Run the repository's full `mise run check`, JavaScript coverage, documentation
build, project-database benchmark, and platform CI. Confirm plain `tsc` reports
version 7, `vue-tsc` uses the compatibility compiler, the UI boundary audit retains
its AST checks, and Storybook tests use their package-local Vitest 4 installation.
Confirm the Linux design-system test command exits after Storybook teardown.
Windows builds must continue to include ASIO.

## Reconsider when

Stable Vue/ESLint tooling supports the TypeScript native API, stable Storybook
supports Vitest 5, the Windows bindings move to a new core family, or the legacy
minimatch consumer is replaced. Remove each compatibility constraint together
with evidence from its owning checks.
