# Continuous integration and releases

The `CI`, `Test`, `Build`, and `Publish` GitHub Actions workflows are the
source of truth for validation, documentation deployment, packaging smoke
builds, and tagged releases.

## Workflows

- **CI** (`.github/workflows/ci.yml`) runs on pull requests and pushes to
  `main`. It calls the reusable Test and Build workflows and builds the
  VitePress user documentation in parallel, then reports their combined result
  through the stable `Gate` job. After the gate succeeds on `main`, it calls the
  shared Pages workflow, which builds the documentation and includes the current
  update manifests. Configure the `Gate` check (shown
  under the `CI` workflow) as the only required status check for pull requests.
- **Test** (`.github/workflows/test.yml`) runs repository checks on Linux x64,
  Windows x64, and macOS. The Linux Checks leg runs
  `mise run ci:check:coverage`, the coverage-producing test pass, while two
  sibling jobs run the work that does not produce coverage:
  `mise run ci:check:static` (formatting, lint, Vue ESLint, Clippy, TypeScript,
  design audits, Storybook, and benchmark compilation) and
  `mise run test:e2e` (the Electron end-to-end suite and crash smoke). Running
  them in parallel keeps the coverage rebuild off their critical path, and no
  test suite is repeated. Windows and macOS run
  `mise run ci:check:native-coverage`, which collects Rust coverage from workspace
  tests and instrumented napi-rs calls while running desktop and project-database
  tests without JavaScript coverage. Each platform also runs
  `mise run test:builtin-vst3` against the pinned Heron plug-in release; the Linux
  end-to-end suite exercises the bundled Gain's native editors. All reports are
  uploaded to Codecov and notifications are published only after the complete
  matrix succeeds. The workflow is reusable through `workflow_call` and can also
  be started manually.
  Callers must pass `CODECOV_TOKEN` when available (see `CI` and `Publish`).
- **Build** (`.github/workflows/build.yml`) packages installers for Windows
  x64, Linux x64 and arm64, and universal macOS as a packaging smoke test. It
  is reusable through `workflow_call` and can also be started manually. CI and
  manual smoke runs disable release LTO (`CARGO_PROFILE_RELEASE_LTO=false`,
  higher `codegen-units`, stripped symbols) so MSVC packaging stays tolerable;
  pass `full_release_profile: true` to keep the Cargo.toml thin-LTO settings.
- **Publish** (`.github/workflows/publish.yml`) runs on a `v*` tag, validates
  that the tag matches `VERSION`, calls the reusable Test and Build workflows
  (Build with `full_release_profile: true`), and creates a draft GitHub Release
  only after both succeed. It stages verified update manifests on the
  `update-manifests` branch before creating the draft, while Release assets
  contain installers only.
- **Publish update manifests** (`.github/workflows/publish-updates.yml`) handles
  the Release `published` event. It promotes the staged manifests and dispatches
  the shared Pages workflow from `main`, the branch allowed by the Pages
  environment's deployment policy. The shared workflow also preserves the
  manifests during ordinary documentation deployments. Staging and promotion
  share a repository-wide concurrency group so their branch writes are serialized.

## Workflow tiers

- Pull requests and pushes to `main` run `CI`, which calls `Test` and `Build`
  and builds the user documentation. The `Gate` job succeeds only when all
  three jobs succeed. Main-branch runs then deploy the documentation to GitHub
  Pages. Installers remain available as workflow artifacts for 14 days.
- Manual `workflow_dispatch` runs are available on `CI`, `Test`, and `Build`.
- Tags beginning with `v` run `Publish`, which calls `Test` and `Build`. After
  both succeed, `Publish` downloads the Build artifacts, stages update metadata,
  and adds the installers, generated release notes, and
  (for public repositories) GitHub artifact attestations to a draft GitHub
  Release. Publishing the draft makes the update manifests available at
  `https://heron.minori.live/updates/` after the Pages deployment succeeds.

The Test and Build workflows install the versions in `mise.lock`, use frozen
pnpm dependencies, and pin the VST3 SDK commit where a native setup is
required. The mise installation, pnpm store, Cargo downloads, and Electron
downloads have separate platform-and-architecture cache keys and are restored on
every run. Only `main` and tag runs save them, so pull requests read main's
entries through the base-branch fallback instead of writing merge-ref copies;
those copies previously consumed most of the repository's 10 GB cache quota and
evicted shared sccache objects. Rust compilation
uses sccache's shared GitHub Actions backend. Check jobs may restore a Cargo `target`
cache; packaging jobs leave it disabled because the directory is large and can
retain stale platform-specific build state. Plug-in integration uses the pinned
Heron bundles prepared by `plugins:prepare`; CI does not build or cache upstream
VST3 or CLAP example plug-ins. Coverage is collected in each Checks test pass.
Every platform uses cargo-llvm-cov's external-test environment
to run Cargo tests, build the napi-rs module with instrumentation, execute the
native binding tests, and export merged Rust profiles after Node exits. Linux
also runs the JavaScript coverage suites and instrumented plug-in analysis with
the prepared Heron Gain VST3. Each test suite runs once. Instrumented artifacts
stay in `target-coverage/`, outside the shared Checks `target` cache.
cargo-llvm-cov chains the sccache
`RUSTC_WRAPPER`, and sccache caches the instrumented
builds and repeat runs reuse them.

### Compiler cache writes

All Test and Build jobs use the same pinned sccache version and default GHA
namespace, allowing compatible compiler outputs to be reused across jobs and
artifacts. Do not partition this namespace by job or replace it with per-job
disk-cache archives. GitHub's branch visibility rules still apply: PR merge-ref
caches cannot warm main or another PR.

Main and tag runs use `SCCACHE_GHA_RW_MODE=READ_WRITE`; PRs and other branch
runs use `READ_ONLY`. This concentrates uploads on the shared producers and
avoids many concurrent PR jobs writing private copies of the same dependencies.
A PR cache miss still compiles normally, but that new output is not published
until a producer builds it. The tool version is pinned because changing sccache
also changes its GHA cache version and forces a cold cache.

The September 2026 audit found explicit cache rate-limit warnings in main's
mise/pnpm cache saves alongside hundreds of sccache write errors. GitHub limits
uploads to [200 cache entries per minute per repository](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching).
Concentrating writes reduces this pressure; a cold main matrix can still hit
the limit. This is not proof that every earlier sccache error was a rate limit.
Each job now reports hits, misses, writes, read/write errors, and recognized
service-error signatures through `mise run ci:report:sccache`. Raw service logs
are kept on the runner because they can contain authenticated URLs. Cache I/O
errors emit a warning without changing test or packaging results.

Validate on the next main run and subsequent PR: main should populate the
shared cache with fewer write errors, and PRs should reuse those entries with
zero writes. Compare total job time as well as cache statistics. If main still
reports errors, use the diagnostic category to distinguish rate limiting,
authorization, entry conflicts, and storage limits before making further changes.

### Universal macOS build ownership

`ci:build:macos-universal` owns the two N-API builds, universalization, native
probe/plug-in builds, and the single desktop bundle build. Both unsigned and
signed packaging tasks depend on it and only package and verify the result.
`ci:verify:macos-universal` checks the agent plist, embedded probe plist, and
universal architectures without rebuilding. The packaging task must not also
exist as a file task: mise merges its dependencies with the TOML definition,
which previously caused the whole native/frontend build sequence to run twice.
The task-boundary regression checks both packaging graphs using mise's dry run;
the actual Mach-O and installer checks execute on the macOS runner.

## Coverage

On the Linux Checks leg, CI runs `mise run ci:check:coverage` with the
combined coverage orchestrator in place of the plain Rust and Vitest runs, so
every test suite executes exactly once with coverage enabled. The static and
design checks, the benchmark compile, and the Electron end-to-end suite run in
the sibling `Static checks` and `Electron end-to-end` jobs, so the coverage
orchestrator no longer waits for linters or a browser launch. In the `static`
job, formatting and script/configuration type checks can run independently of
native compilation. Only checks that need generated package loaders, typings,
or wire declarations depend on their preparation tasks. Cargo checks sharing
the normal target directory are ordered with mise's `wait_for` when scheduled
together. The orchestrator first runs the Rust
tests and builds instrumented napi-rs modules, then runs the JavaScript tests and
merged report; no test suite or native build is repeated. Cargo doc tests still
execute as correctness checks, but
their bodies are not instrumented into the external-test LCOV report. The same
mise task reproduces the Linux leg locally.

The mise coverage tasks run `scripts/rust-coverage.ts` directly with Node.js.
The script reads `cargo llvm-cov show-env` output as data and passes the
instrumentation environment to its Cargo and Node subprocesses. Starting a
coverage pass therefore needs no compiled Rust task driver, including under
the instrumented target directory. The `local`, `ci`, and `native` modes retain
their respective test suites; `native` runs the desktop and project-database
tests with the original environment after exporting Rust coverage.

The workspace and `heron-dsp-node/bench-internals` feature selectors apply when
Cargo creates the instrumented test binaries and napi-rs modules. Linux also
runs `mise run test:plugin-analysis` in the instrumented environment. Its
`plugins:prepare` dependency supplies Heron Gain, and the analysis smoke exercises
the passthrough and VST3 paths. Windows and macOS export Rust coverage after the
native binding tests. The final `cargo llvm-cov report` follows
cargo-llvm-cov's external-test workflow and exports every object and raw profile
collected through that environment. It does
not repeat build selectors; the locked cargo-llvm-cov version rejects them on the
`report` subcommand.

For ad-hoc local coverage, use the dedicated scripts:

```sh
pnpm test:coverage:js
# or the combined cross-language pass, including native calls:
mise run coverage
```

JavaScript coverage requires `@vitest/coverage-v8` (installed with the
workspace). Rust coverage requires the locked `cargo-llvm-cov` tool and the
`llvm-tools-preview` Rust component from `mise.toml`. Reports land under
`coverage/` (gitignored) and are uploaded to Codecov with the repository
`CODECOV_TOKEN` secret. The combined Rust coverage run writes instrumented
objects to `target-coverage/` so they stay out of the shared `target/` cache,
and keeps the sccache wrapper so repeat runs reuse cached builds. Each coverage
run clears only the raw `*.profraw` counters (`cargo llvm-cov clean
--profraw-only`), keeping the instrumented artifacts so local runs stay
incremental.
`cargo llvm-cov report` re-merges the fresh profiles into `*.profdata`, so a
retained profile merge cannot serve a stale report. LCOV source
paths are rewritten relative to the repository before upload so reports from
POSIX and Windows checkouts merge against the same files. Use the combined
command when native calls made by JavaScript must be reflected in Rust coverage;
it collects coverage for the current host platform only and does not emulate
the other supported operating systems.

`codecov.yml` tags the Linux JavaScript upload with `javascript` and the three
Rust uploads with `rust-linux`, `rust-windows`, and `rust-macos`. These flags
make platform results inspectable but do not create flag-specific status gates;
carryforward is disabled so a missing platform report cannot reuse stale data.
Codecov merges all four uploads into the repository totals. Repository-level
project and patch statuses and the components for each coverage-producing
workspace package or crate (`desktop`, `contracts`, `project-db`,
`project-model`, `ui`, and the `dsp-*` / host crates) remain the
coverage gates. The workflow uses manual Codecov notification triggering so
statuses and the PR comment are published only after all matrix uploads succeed.
Rust coverage ignores vendored `third_party/` sources (also listed under
`ignore` in `codecov.yml`) so path dependencies such as `ara2-bridge-host` do
not dilute first-party coverage totals. C and C++ SDK sources are not included
in the Rust LCOV report.

## Application distribution

[Application updates](application-updates.md) owns installed eligibility, channel
metadata, scheduling, installation admission and shutdown/recovery.
[Homebrew distribution](homebrew-distribution.md) owns Tap synchronization.
[Built-in plug-in distribution](builtin-plugin-distribution.md) owns the separately
released runtime dependency and its upgrade PRs.

## Creating a release

`VERSION`, the root package, all workspace packages, and the Cargo workspace
version must match before `Test` and `Build` can pass. Prepare and publish a
release with:

```sh
mise run version:sync
mise run version:check
git tag "v$(cat VERSION)"
git push origin "v$(cat VERSION)"
```

The tag must equal `v` followed by the exact contents of `VERSION`. A
prerelease version such as `0.2.0-beta.1` creates a GitHub prerelease; other
versions become the latest release. Rerunning `Publish` replaces the assets on
an existing draft release.

Tagged releases require the macOS universal artifact to be signed with the
Developer ID Application identity stored in the `MAC_CSC_LINK` and
`MAC_CSC_KEY_PASSWORD` Actions secrets. Notarization uses the App Store Connect
API secrets `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`;
`APPLE_API_KEY_P8` contains the Base64-encoded `.p8` private key. Pull requests
and ordinary CI builds never receive these credentials. The `sign_macos` input
only takes effect for a `v*` tag, so a branch or manual Build run cannot opt into
signing. Tagged releases use `electron-builder.release.yml`, which forces code
signing and enables electron-builder's notarization integration. Before upload,
CI independently checks the Developer ID authority, Team ID, Gatekeeper
assessment, and stapled notarization ticket.
