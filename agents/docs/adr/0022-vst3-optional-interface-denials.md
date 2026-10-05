# ADR-0022: Tolerate declined optional VST3 interface queries

- Status: Accepted
- Date: 2026-10-05
- Owners: project maintainers
- Scope: third-party compatibility in `ComPtr::query_optional`; supersedes only ADR-0021's optional extension lookup policy
- Related: regression after #204, [VST3 result contracts](0021-vst3-result-contracts.md)

## Context

After #204, APU effects and Auto-Tune Pro fail during instance initialization
with `queryInterface` result `1`, while Heron Gain still loads. Optional
extension lookups now propagate every result except the SDK's NoInterface
encodings. This converts a third-party wrapper's False denial into a rejected
load before any editor window is created.

The pinned SDK documents NoInterface for an unsupported interface. Heron's
compatibility policy must also accommodate the observed False denial without
claiming that the extension exists or weakening required interface acquisition.

## Decision

For optional `queryInterface` calls, accept NoInterface as absence and additionally
treat False (`1`) with a null output pointer as absence. The caller continues with
its existing behavior for an unavailable extension. A False response with a
non-null pointer remains an operation error; the host must not use that pointer.

Required `ComPtr::query` calls still require Ok and a non-null interface. Optional
queries likewise reject null success, NotImplemented and unknown failure codes.
Successful queries retain their existing owned-reference lifetime. No other
method's result policy, process/thread boundary, wire outcome or real-time
behavior changes.

## Alternatives rejected

### Require NoInterface for every optional denial

This follows the SDK literally but rejects otherwise loadable third-party
effects, as reproduced through the embedded N-API runtime.

### Ignore every failed optional query

This would hide unexpected native failures and malformed responses. The
compatibility exception is limited to the observed False-with-null response.

### Exempt individual plug-in names

The failure occurs across multiple vendors and optional interfaces share one
query boundary. Artifact-specific rules would duplicate the same result policy.

## Consequences

Effects can load without advertising unsupported extensions. Required DSP and
lifecycle failures remain errors under ADR-0021. False-with-null is a host
compatibility allowance rather than a new claim about SDK conformance.

## Verification

Use the COM adapter fake to prove optional absence for False and the supported
NoInterface encodings, required-query rejection for the same results, rejection
of malformed success and non-null False, and balanced successful references.
The False regression must fail before the fix and pass afterward.

Rebuild the N-API addon and exercise real third-party instance loading, parameter
enumeration and unloading. Keep hardware/vendor-specific smoke evidence separate
from the deterministic regression; it establishes only the exercised artifacts
and operations.

Real-plugin validation also exposed a pre-existing initialization-order fault:
Auto-Tune Pro dereferences its component connection while answering MIDI mapping
queries. Read those mappings after both connection points have been connected.
Use the existing `apps/desktop/scripts/plugin-analysis-smoke.ts` with a plug-in
path and class ID to exercise state cloning, parameter replay and processing in
addition to loading.

## Reconsider when

New compatibility evidence requires another narrowly defined denial policy, or
interface ownership on rejected queries needs a separate recovery contract.
