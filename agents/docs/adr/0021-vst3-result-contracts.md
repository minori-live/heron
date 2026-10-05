# ADR-0021: Interpret VST3 results by method and effect

- Status: Accepted
- Date: 2026-10-05
- Owners: project maintainers
- Scope: VST3 result interpretation and contained operation failures; existing runtime states and ownership remain defined by ADR-0001
- Related: [Native boundary](../native-call-boundary.md), [Runtime ownership](0001-runtime-ownership-and-transactions.md)

## Context

VST3 uses `tresult` for several distinct contracts: operation completion,
capability queries, negotiation, optional notifications and event handling.
`kResultFalse` can mean that a format is unsupported, an input event was not
handled, or an arrangement was declined after the plug-in changed its buses.
It does not independently establish a broken processor or a fatal native error.

Heron previously combined raw SDK result checks with host-originated failures
such as a full parameter queue and a temporarily paused processor. That loses
the operation's commit outcome and can permanently fail a healthy instance.
The SDK also uses different numeric encodings across platforms; neither the
sign nor a hardcoded error number establishes a portable contract.

## Decision

### Method contracts

Decode explicitly supported SDK-native and COM-compatible encodings, including
the existing cross-platform wrapper encodings for NotImplemented and
NoInterface. Keep the raw result and operation identity in diagnostics,
classify known results by the method's contract, and reject unknown codes as
operation failures. `kResultOk` and `kResultTrue` are aliases. There is no global
rule accepting `kResultFalse` or `kNotImplemented`; an operation's owner still
determines whether its failure affects required DSP work or advisory work.
Host validation, queue capacity and temporary processing availability have typed
host outcomes and do not impersonate SDK result codes.

At the native request boundary, retain the format, instance when available,
failure stage, method and optional raw result as structured diagnostic details.
Queue refusal before enqueue is a retryable busy result with no commit; failure
after enqueue requires reconciliation. A discarded unpublished load candidate
reports no graph commit, while an active instance with failed state recovery
retains the affected resource's quarantined outcome. Successful rollback turns
the rejected edit into a known no-commit outcome. Message text never selects
these classifications.

| Contract                            | Methods                                                                | Result policy and impact                                                                                                                                                                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Usage hint                          | `setIoMode`                                                            | Ok accepts the hint; False or NotImplemented declines it. Continue with the plug-in's default behavior. Other codes fail preparation.                                                                                                                                      |
| Optional factory context            | `setHostContext`                                                       | Ok installs context; False or NotImplemented declines the extension. Other codes fail module preparation.                                                                                                                                                                  |
| Optional extension lookup           | `queryInterface` for an optional interface                             | NoInterface means the extension is absent. Unexpected failures remain errors rather than silently absent extensions.                                                                                                                                                       |
| Presentation latency hint           | `setAudioPresentationLatencySamples`                                   | A rejected advisory update retains its diagnostic and does not invalidate otherwise established DSP setup.                                                                                                                                                                 |
| Required lifecycle or DSP operation | `initialize`, `setupProcessing`, `activateBus`, `setActive`, `process` | Require Ok. Reject the current preparation or operation; a processing failure contains the affected instance. False does not prove that the plug-in is permanently unusable.                                                                                               |
| Processing notification             | `setProcessing`                                                        | Accept Ok and NotImplemented, matching the SDK base implementation. False and unknown codes remain rejected; no official False-as-success guarantee is assumed.                                                                                                            |
| Capability query                    | `canProcessSampleSize`, editor platform support and resizing queries   | True proves support. False means unsupported. An unavailable capability must not be recorded as a supported one; preserve the scope of the requested format or editor feature.                                                                                             |
| Layout negotiation                  | `setBusArrangements`                                                   | Make at most one counter-offer after False. After either True or False, reread every bus count, arrangement and channel count. Reject changed bus counts or inconsistent information; the existing main-layout check still requires Heron's exact layout or owned adapter. |
| Controller synchronization          | `setParamNormalized`, `setComponentState`                              | False or NotImplemented declines UI synchronization without undoing a committed processor parameter or an accepted component state. Unexpected errors retain diagnostics independently of the actual processor outcome.                                                    |
| Complete processor state            | component `getState` and `setState`                                    | Require success for a complete save or restore. A refused snapshot preserves prior committed bytes; a refused restore cannot be reported as successful or treated as an unchanged live instance.                                                                           |
| Controller state                    | controller `getState` and `setState`                                   | The optional controller state may be absent when getState is NotImplemented. An existing nonempty blob rejected during restore must not silently become an empty blob or a successful restore.                                                                             |
| Component/controller communication  | `connect`, `disconnect`, `notify`                                      | Interface absence, connection completion, cleanup and an unhandled message are distinct. A present connection point's rejected connect is not a successful connection.                                                                                                     |
| Editor input and geometry           | key, wheel and focus handlers; `getSize`, `onSize`, attach/remove      | Unhandled input and unsupported resizing are normal feature results. Attachment or geometry failure affects the editor operation, while uncertain detach remains subject to ADR-0001's ownership quarantine rule.                                                          |

Optional synchronization is a compatibility policy for a specific method, not
permission to swallow other methods' failures. Controller errors after a
processor parameter has entered its bounded queue cannot change that already
committed enqueue into a rejected parameter request. The requested flush still
runs, and a real flush failure keeps its own failure outcome.

### Lifecycle, side effects and recovery

Controller and editor calls remain on the owning UI thread. Bus negotiation and
processing setup occur in the inactive component states prescribed by VST3;
`setProcessing` brackets processing while the component is active. None of the
classification or recovery work adds allocation, logging, blocking or UI work
to the audio callback.

An SDK setter's rejected result does not establish absence of side effects.
The host validates the method's postconditions, and state mutation recovery
must restore a captured prior state or rebuild an instance from committed state.
If recovery cannot establish known state or ownership, quarantine the affected
resource under ADR-0001. Keep rejected or partially restored state out of the
audio callback until recovery succeeds; a reactivation attempt does not prove
that the earlier state survived. Preserve committed component bytes separately
from optional controller synchronization; UI acceptance is not evidence that
processor state was restored, nor is UI refusal evidence that accepted component
bytes were rejected.

IO and latency restarts keep processing unavailable if deactivation or
reactivation fails, and report an uncertain mutation requiring reconciliation.
An explicit successful restart establishes the active processing configuration
and clears its own restart barrier. It cannot clear a barrier caused by a failed
state restore or a committed parameter flush: successful lifecycle calls do not
establish those data postconditions. A complete successful state recovery can
clear these barriers after it establishes the requested known state.

Dual-mono mutations keep both processor leases paused through the complete
paired operation. If only one lane accepts a bus update, a successful local
restart or state restore cannot prove that the lanes share the same retained
bus configuration; preserve that paired uncertainty until rebuilding establishes
a shared configuration.

A temporary control-thread pause makes that block unavailable to processing.
It does not transition the instance into permanent failure. The callback uses
the existing bounded contained-output behavior and can resume once the pause
ends. Nested control operations retain the enclosing pause until its owner
finishes, including when an inner recovery succeeds. Actual process failure
retains the existing failure signal and explicit recovery semantics. This
distinction introduces no new runtime state or process boundary.

### Sources and implementation scope

The pinned SDK is the method-contract reference. In particular,
`pluginterfaces/vst/ivstaudioprocessor.h` describes False-as-negotiation with
changed buses; SDK `AudioEffect::setProcessing` and `Component::setIoMode`
default to NotImplemented. The
[official bus setting workflow](https://steinbergmedia.github.io/vst3_dev_portal/pages/Technical%2BDocumentation/Workflow%2BDiagrams/Bus%2BArrangement%2BSetting%2BSequence.html)
requires the host to read the plug-in's arrangements after a declined request.
The [persistence contract](https://steinbergmedia.github.io/vst3_dev_portal/pages/FAQ/Persistence.html)
separates processor/model state from controller/UI state.

This decision refines the existing failure-containment contract. It does not
provide native crash isolation, a helper restart mechanism, automatic recovery
from arbitrary third-party calls, or a new claim of platform editor teardown
safety. Delivery and verification of individual paths must identify the real
runtime outcome; accepting this ADR is not evidence that every ownership
recovery path is implemented.

## Alternatives rejected

### Treat every nonzero result as fatal

This conflates unsupported capabilities and optional work with failed DSP,
turns temporary host contention into permanent plug-in failure, and ignores
platform encodings and the operation's commit point.

### Accept every False or NotImplemented

Required lifecycle, state and DSP operations need proven postconditions.
Permissive treatment can expose an inactive processor, incompatible buffers or
partially restored state as successful operation.

### Accumulate plug-in-specific result exemptions

Per-artifact exemptions conceal the method contract and can fail again for the
next plug-in. Method policies are the default; any future artifact-specific
compatibility rule needs reproducible evidence and an explicit bounded scope.

## Consequences

Legal SDK capability denials and optional operations stop poisoning unrelated
functionality. Result handling becomes reviewable by operation and effect.
Rejected mutations remain more demanding than ordinary reads: they may require
snapshot restoration, replacement or quarantine rather than one return-code
check. Diagnostic data must retain the raw SDK result without using free-form
messages to choose protocol outcomes.

## Verification

Use controlled plug-in fakes at Heron's host boundary to prove declined hints,
unsupported formats, rejected layouts with changed bus state, required-method
failure, controller refusal after parameter enqueue, flush completion,
state restore refusal and recovery, and resume after a temporary processor
pause. Assert actual accepted values, output, retained bytes or typed outcomes;
SDK enum-value conformance alone does not prove Heron's policy.

Retain targeted native runtime/MessagePack evidence for typed result mapping,
allocation invariants for callback containment, and platform/native fixture
checks for the integration paths changed by this policy. A real plug-in smoke
test establishes only that artifact and exercised operations.

## Reconsider when

A newer official VST3 contract changes a method's required result behavior,
reproducible compatibility evidence justifies a narrower exception, or a new
ownership model changes how the host can establish a mutation's terminal state.
