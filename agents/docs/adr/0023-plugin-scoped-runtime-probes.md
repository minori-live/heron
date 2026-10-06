# ADR-0023: Probe the selected plug-in before runtime loading

- Status: Accepted
- Date: 2026-10-06
- Owners: project maintainers
- Scope: isolated VST3 and CLAP catalog probe requests and runtime capability caching
- Related: [Runtime ownership](0001-runtime-ownership-and-transactions.md), [Native boundary](../native-call-boundary.md)

## Context

One plug-in artifact can export many independently selectable plug-ins. Heron's
runtime preparation previously deep-probed every exported plug-in before loading
one selection. Each VST3 class can require several isolated layout probes.
Unrelated classes therefore increased insertion time, and a slow or failed probe
held up queued project edits. Caching by artifact path also made different
selections share the same pending work and failure.

## Decision

Runtime preparation identifies its probe by the existing explicit locator:
`{ format, artifactPath, nativeId }`. Electron main passes the native ID as a
separate `--plugin-id <nativeId>` argument to the corresponding isolated probe.
The artifact path remains a separate argument. Both probe executables reject
invalid arguments and missing requested plug-ins with an unsuccessful exit.

The native probe enumerates factory metadata to find the requested identity,
then inspects only that plug-in. VST3 ARA inspection is limited to the selected
class's matching factory. Unrelated plug-ins must not be instantiated or have
their layouts inspected. Without a selector, catalog and built-in discovery
retain their existing full-artifact behavior and JSON output shape.

Main coalesces and caches runtime capability probes by the complete locator.
Only the requested descriptor is updated. Failure invalidates that selection's
pending cache entry and marks that descriptor unavailable through the existing
load-error path; later preparation can retry. Sibling descriptors and their
pending or successful probes remain independent. A missing selected class must
not fall back to another class or unverified startup metadata. Explicit rescan
invalidation continues to clear runtime probe results.

Probe results remain capability evidence before runtime loading. These read-only
catalog operations do not commit an audio graph or persisted project state. The
existing embedded runtime, native call ownership and graph commit rules apply
after capability validation.

## Alternatives rejected

### Deep-probe the entire artifact on first use

This prewarms other classes but makes one insertion depend on every sibling's
cost and behavior, especially in artifacts containing many plug-ins.

### Infer layouts from display names

Names such as Mono are useful diagnostic clues, but native capability checks
remain the authority for the requested class.

## Consequences

The amount of deep inspection for one insertion is independent of the number
of unrelated classes. Opening the module and enumerating metadata still occur,
and the selected plug-in's own probe or runtime calls can still be slow or fail.
Different selections in one artifact may require separate module opens.

## Verification

Test the native selection before invoking deep inspection, including an unknown
ID that never inspects a fallback class. Verify the TypeScript command arguments,
same-selection coalescing, independent sibling results and failures, and retained
full-catalog discovery. Preserve the Mono layout-rejection cleanup regression.

## Reconsider when

Measured metadata enumeration or repeated module loading dominates insertion,
or a format requires joint capability negotiation across exported plug-ins.
