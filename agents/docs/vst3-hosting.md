# VST3 hosting contracts

This document owns Heron's method-specific compatibility and mutation recovery
rules. The pinned SDK defines method contracts; Heron owns how those outcomes
affect operations. See [the native boundary](native-call-boundary.md) for execution
and [architecture](architecture.md#graph-publication-and-plug-in-containment) for
containment. These rules do not provide native crash isolation.

## Result interpretation

Decode explicitly supported SDK-native and COM-compatible encodings, including
NotImplemented/NoInterface wrapper encodings. Ok and True are aliases. Preserve
raw result, method, format, instance and failure stage in structured diagnostics.
Unknown codes fail the operation. There is no global False/NotImplemented success
rule. Host validation, queue capacity and temporary availability use typed host
outcomes, not invented SDK codes.

| Contract                            | Methods                                                                | Result policy and impact                                                                                                                                                                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Usage hint                          | `setIoMode`                                                            | Ok accepts the hint; False or NotImplemented declines it. Continue with the plug-in's default behavior. Other codes fail preparation.                                                                                                                                      |
| Optional factory context            | `setHostContext`                                                       | Ok installs context; False or NotImplemented declines the extension. Other codes fail module preparation.                                                                                                                                                                  |
| Optional extension lookup           | `queryInterface` for an optional interface                             | NoInterface or False with a null output means absent. False with a non-null pointer, null success, NotImplemented and unknown codes remain errors.                                                                                                                         |
| Presentation latency hint           | `setAudioPresentationLatencySamples`                                   | A rejected advisory update retains its diagnostic and does not invalidate otherwise established DSP setup.                                                                                                                                                                 |
| Required lifecycle or DSP operation | `initialize`, `setupProcessing`, `activateBus`, `setActive`, `process` | Require Ok. Reject the current preparation or operation; a processing failure contains the affected instance. False does not prove that the plug-in is permanently unusable.                                                                                               |
| Processing notification             | `setProcessing`                                                        | Accept Ok and NotImplemented, matching the SDK base implementation. False and unknown codes remain rejected; no official False-as-success guarantee is assumed.                                                                                                            |
| Capability query                    | `canProcessSampleSize`, editor platform support and resizing queries   | True proves support. False means unsupported. An unavailable capability must not be recorded as a supported one; preserve the scope of the requested format or editor feature.                                                                                             |
| Layout negotiation                  | `setBusArrangements`                                                   | Make at most one counter-offer after False. After either True or False, reread every bus count, arrangement and channel count. Reject changed bus counts or inconsistent information; the existing main-layout check still requires Heron's exact layout or owned adapter. |
| Controller synchronization          | `setParamNormalized`, `setComponentState`                              | False or NotImplemented declines UI synchronization without undoing a committed processor parameter or an accepted component state. Unexpected errors retain diagnostics independently of the actual processor outcome.                                                    |
| Complete processor state            | component `getState` and `setState`                                    | Require success for a complete save or restore. A refused snapshot preserves prior committed bytes; a refused restore cannot be reported as successful or treated as an unchanged live instance.                                                                           |
| Controller state                    | controller `getState` and `setState`                                   | The optional controller state may be absent when getState is NotImplemented. An existing nonempty blob rejected during restore must not silently become an empty blob or a successful restore.                                                                             |
| Component/controller communication  | `connect`, `disconnect`, `notify`                                      | Interface absence, connection completion, cleanup and an unhandled message are distinct. A present connection point's rejected connect is not a successful connection.                                                                                                     |
| Editor input and geometry           | key, wheel and focus handlers; `getSize`, `onSize`, attach/remove      | Unhandled input and unsupported resizing are normal feature results. Attachment or geometry failure affects the editor operation, while uncertain detach remains subject to the architecture's ownership quarantine rule.                                                  |

Optional interface lookup permits the observed False-with-null denial without
advertising an extension. Required `ComPtr::query` still requires Ok and a nonnull
interface. Successful references retain normal ownership; malformed responses
do not grant access to an output pointer. This is a bounded host compatibility
allowance, not a claim that vendors follow the SDK exactly. Read MIDI mappings
after both component/controller connection points are connected.

## Commit outcomes and recovery

Queue refusal before enqueue is retryable busy with no commit. After enqueue,
reconcile outcomes; controller synchronization refusal cannot turn a committed
processor value into a rejected request or suppress its flush. Actual flush
failure retains its own outcome. Discarded unpublished load candidates commit no
graph. Successful rollback makes an edit known not committed; uncertain active
state or ownership quarantines the affected resource. Messages never classify
these outcomes.

A rejected setter may already have changed state. Validate postconditions and
restore captured prior state or rebuild from committed bytes. Keep partially
restored state out of processing until recovery succeeds. Lifecycle reactivation
alone cannot prove the old data survived. Component bytes and optional controller
state retain independent outcomes.

IO/latency restart keeps processing unavailable if deactivation/reactivation fails.
A successful restart clears only its restart barrier, not uncertainty caused by
failed restore or committed parameter flush. Complete successful state recovery
can clear those barriers after proving the requested state. Dual-mono operations
keep both leases paused for the entire paired mutation; one lane's successful
restart cannot resolve divergent bus configuration. Rebuild to establish it.

Temporary control-thread pause yields bounded unavailable output, not permanent
instance failure. Nested work retains its enclosing pause even if inner recovery
succeeds. Genuine process failure uses the explicit failure/recovery path.
Controller/editor calls remain on the UI owner; bus setup uses inactive states
and setProcessing brackets processing while active. No classification/recovery
adds callback allocation, blocking, logging or UI work.

## Parameter gesture delivery

Native GUI parameter values coalesce by parameter at block start, preserving the
latest value and deferring entries that do not fit. Sample-offset automation
keeps its separate event order. Cancellation must deliver the final correction
even when a stale parameter cache still equals the initial value. Rapid drags
must not exhaust capacity and lose that correction.

Before serialization, state capture flushes admitted GUI values on the paused
control thread and stops on the first processing error. Prepared GUI-flush storage
does not consume next-block scheduled automation. The callback uses one bounded
drain with prepared storage and no locks. Editor closure balances gestures and
revokes only that editor generation's host bridge and solo audition.

## Evidence and references

Use Heron-owned host fakes and integration paths to assert accepted values,
retained bytes, output and typed outcomes. SDK enum conformance is not evidence
of host behavior. Real plug-in smoke establishes only the exercised artifact and
operations; callback invariants and platform editor lifetime need their own
appropriate evidence under [testing policy](testing.md).

Historical compatibility evidence includes APU/Auto-Tune optional-query denials
and Auto-Tune mapping initialization after connection. Avoid per-name exemptions
when a bounded method contract covers the behavior.

- [Bus arrangement workflow](https://steinbergmedia.github.io/vst3_dev_portal/pages/Technical%2BDocumentation/Workflow%2BDiagrams/Bus%2BArrangement%2BSetting%2BSequence.html)
- [Processor/controller persistence](https://steinbergmedia.github.io/vst3_dev_portal/pages/FAQ/Persistence.html)
