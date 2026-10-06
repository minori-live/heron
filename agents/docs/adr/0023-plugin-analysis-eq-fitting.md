# ADR-0023: Plugin Analysis parametric EQ fitting

- Status: Accepted
- Date: 2026-10-05
- Owners: project maintainers
- Scope: first-version magnitude approximation, independent window and renderer worker ownership
- Related: [ADR-0016](0016-plugin-analysis.md), [ADR-0017](0017-plugin-analysis-comparison.md),
  [EQ fitting pull request](https://github.com/minori-live/heron/pull/211),
  [Plugin Analysis manual](../../../docs/content/manual/plugin-analysis.md#fit-a-parametric-eq)

## Context

Users need a small set of EQ parameters that approximates one measured Linear
Frequency Response. The accepted feature is a quota of Bell, LowShelf or
HighShelf sections, defaulting to three, with an independent overall gain and
visible fit error. Numerical search can take substantially longer than a UI
frame and must not run on the renderer UI or audio callback thread. Fitting has
its own window so controls and results can be inspected independently of the
Analysis plots.

The existing report contains 384 logarithmically spaced magnitude samples per
input-to-output path, a sample rate and measurement-quality diagnostics. It has
no per-bin confidence mask. A finite value can be a clamped measurement floor,
and the default L + R display represents two paths rather than their average.

## Decision

Electron main owns one independent top-level EQ Fit `BrowserWindow` for the
Analysis session. The Analysis magnitude view exposes the entry action only
for a single measured path; it is hidden for L + R, M + S, difference and other
response views. The fit window owns the quota, computation, measured/fitted
overlay and residual results. It requires one explicit chain choice within the
window for an overlaid comparison; an individual-chain view identifies the
chain already. Choosing the entry again for the same target focuses the existing
window and retains its controls and result. Closing it discards the fit; a later
open starts fresh with quota three and no result.

The secure fit renderer has its own narrow typed preload API. Main authenticates
the requesting owner, main frame and entrypoint. The Analysis renderer supplies
an explicit report ID, revision and semantic input/output path coordinates;
main resolves the data from the session's authoritative report. Renderer-supplied
sample arrays cannot become the target. The fit window receives only its owned
context and window controls, with no authority to mutate the project, experiment
chain or native instances. Context delivery and failures use serializable typed
outcomes. The window does not depend on an ambient current report or receive the
general application preload API.

Selection requests carry the Analysis resource handle, expected revision,
mutation identity, a monotonic sequence, a nullable selection and an explicit
open intent. Main validates the target before accepting a selection and retains
the latest request outcome so duplicate delivery cannot reopen or refocus the
window. Older sequences are rejected; owner snapshots expose the last sequence
for renderer reload reconciliation. Manual child close retains that sequence and
receipt, while a new Analysis owner resets them. Child snapshots carry source
and selection revisions and omit unchanged report bodies by known report ID.
Window commands use explicit maximize state and bounded, acknowledged receipts.

The fit is volatile and read-only. The quota accepts one through eight sections
and is an upper bound; overall gain is outside it. The target is the measured
magnitude, not an inverse correction. A fit neither inserts an effect nor
recovers the original plug-in's internal parameters.

A dedicated renderer Web Worker owns numerical optimization. Its request is a
serializable snapshot of the raw measured frequencies, magnitudes, sample rate
and fitting settings. The worker does not request new measurements, access native
instances, change project state or consume display interpolation. The fit
renderer owns at most one fitting worker; cancellation, replacement and disposal
terminate it. The window/context API crosses the Electron process boundary;
the numerical model introduces no native protocol, audio-thread work or durable
data.

The controller associates each request with its report ID, report revision,
current experiment revision, comparison mode, path, selected chain, quota and a
monotonically increasing request generation. Any relevant change terminates the
job and clears its result. A late callback may publish only when its generation
and target still match. Repeated measurement runs invalidate fits even when the
experiment revision is unchanged; an unchanged snapshot identity does not.
Invalid or unavailable context clears the fit while leaving the window open
with a prompt to choose a current single path in Linear Magnitude. Leaving that
view also invalidates the context. Worker failure is a recoverable fit error and
permits retry without discarding the measurement report. The only fit commit is
publication of a current result.

The Analysis owner explicitly closes its fit window before session cleanup,
including owner disposal and application shutdown. Window loading failure
destroys the candidate and permits retry; a late load or context read cannot
resurrect a closed or replaced owner. Closing the fit window terminates its
worker and clears its renderer state without closing Analysis or retiring its report.
Native instance cleanup retains the existing session failure and quarantine
policy.

The implementation uses bounded multi-start nonlinear least-squares search with
discrete filter-type selection. It evaluates the digital biquad transfer function
at the report's sample rate and original frequency bins, using the RBJ peaking
and shelf coefficients. Frequency, gain and Q have explicit finite bounds, and
invalid or unstable candidates cannot become results. For all three types,
`alpha = sin(2*pi*f/Fs)/(2*Q)`; shelf Q is a damping parameter rather than a
plug-in-independent shelf-slope setting. The
[W3C Audio EQ Cookbook](https://www.w3.org/TR/audio-eq-cookbook/)
defines the coefficient convention. The manual records bounds and the relation
to shelf slope S.

Input validation rejects malformed or insufficient data, unusable signal floors
and clearly unreliable measurements. Less decisive quality indicators produce
visible warnings. Report-level diagnostics cannot establish per-bin SNR, so a
successful fit is not a measurement-confidence certificate. The whole input is
accepted or rejected; the fitter does not silently drop unreliable bins. Error
uses all raw samples with equal weight: residual is measured minus fitted dB,
RMS is the square root of mean squared residual, and maximum error is maximum
absolute residual. The view shows measured and fitted curves, residual, RMS and
maximum error, the best bounded overall-gain-only baseline and elapsed fitting
time. The baseline gain is the mean measured dB clamped to the overall-gain bounds.

## Alternatives rejected

- UI-thread optimization risks stalls and makes cancellation dependent on the
  solver yielding. A worker provides an independently terminable computation.
- Native-worker fitting would reuse a numerical host but add a native protocol
  and ownership coupling for a calculation that only needs an immutable report.
- An inline panel ties fitting controls and results to the Analysis layout. A
  separate window supports the requested independent inspection while keeping
  its lifetime and data authority bound to the Analysis owner.
- Passing measured arrays from the opening renderer would bypass authoritative
  report identity. Main resolves explicit identities and path coordinates before
  delivering a fitting context.
- Averaging displayed paths or fitting smoothed pixels would silently change the
  target. Explicit selection and raw samples preserve the measurement contract.
- Unbounded search, a fixed filter type, or exactly quota-many active sections
  can produce extreme or unnecessary parameters. Bounded type selection and an
  independent overall gain favor useful, inspectable approximations.

## Consequences

Fitting is reproducible for the same input and remains separate from measurement
and playback. The implementation can change its search strategy within this
ownership and response contract. It makes no global-optimum claim; an increased
quota can cost more work and still fail to represent the target accurately.

The result models magnitude only. It does not identify phase, delay, nonlinear or
time-varying behavior, or a stereo transfer matrix. A fit to a cross-channel path
does not create that routing when applied to an ordinary single-channel EQ.
Narrow high-Q features between the 384 sampled frequencies remain unresolved.
Different products can interpret Q differently, especially for resonant shelves.

## Verification

Numerical tests cover flat gain, known Bell and shelf responses, mixed sections,
insufficient quota, unrepresentable targets, sample rates, invalid and no-signal
data, finite bounds and stability. Controller/component tests cover explicit path
and chain selection, quota defaults and limits, cancellation, report and setting
invalidation, late callbacks, failures and repeated interactions. Main/preload
tests cover sender authority, authoritative report resolution, stale targets,
window reuse, load/close races and owner cleanup. Desktop evidence must exercise
the actual independent window, worker and result display, including hidden
entry states, focus reuse, context invalidation and fresh close/reopen behavior.
Representative fixture runs record baseline/final error and elapsed time without
promising device-independent performance. Existing lint, type, aggregate and CI
checks remain required.

## Reconsider when

Fitting needs application to a live audio chain, persistence/export compatibility,
phase or coupled-channel modeling, a different measurement-confidence contract,
or native computation that cannot fit the renderer-worker ownership boundary.
