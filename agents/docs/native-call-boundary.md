# Native call boundary

Only Electron main may import `@heron/dsp-node`. Renderer code calls the typed
preload API exposed as `window.heron`; preload forwards validated operations to
main and never exposes the addon itself.

```text
renderer -> preload -> Electron main -> @heron/dsp-node -> EmbeddedAudioHost
```

The final arrow is a same-process N-API call. `AudioHostRuntime` owns the Rust
runtime and exposes asynchronous control requests, priority heartbeat,
parameter enqueue, direct telemetry, host-event draining, bounded main-thread UI
draining, and explicit close. Control promises are Tokio futures backed by bounded
channels and oneshot terminal replies; they must not occupy a libuv worker with
`blocking_send`, `recv`, or `recv_timeout` while native work is pending.

Potentially blocking engine and device operations run on Tokio's blocking pool.
Actor lanes preserve the ordering required by a resource while isolating that
resource from heartbeat, parameter ingress, background I/O, and unrelated
control requests. Closing the runtime initiates shutdown and reaps the runtime
thread in the background; it must not join the runtime thread from Electron's
main thread.

The MessagePack request/response envelope is retained as a local ABI so Rust
protocol validation stays centralized. It must not grow process-lifecycle,
framing, attachment, shared-memory, lease, or retry semantics. Large state is
carried inline until a measured local-boundary bottleneck justifies a simpler
typed N-API representation.

Electron main validates the response envelope on both control and priority
calls before reading the result: the response must be an object, answer the
issued request id, and contain an object result with a string discriminator.
Malformed responses follow the gateway's unavailable/error path; they must not
escape as accidental property-access errors. Native structured failures retain
their error details and originating command context.

The MIDI input actor also owns the counted set of active Note On lifecycles.
Electron main samples that small state through the existing MIDI runtime
snapshot at a UI cadence and forwards it to the renderer. Route filtering,
key-signature-aware chord recognition, and display formatting remain renderer
work; none of them run in an audio callback.

`AudioHostService` owns one runtime for the application lifetime. Shutdown asks
the runtime to stop, drains ordered host events, settles pending calls, and
closes the addon. Runtime thread settings apply on the next launch rather than
recreating the native runtime in place.

Control requests do not have a semantic deadline after they enter the embedded
runtime. Dropping a waiter cannot cancel actor or third-party plug-in work and
could otherwise report failure before a stateful command commits. Per-command
slow thresholds are diagnostic only: requests are counted and logged when they
cross the threshold while callers continue waiting for a terminal result.
User-visible long operations belong in background-operation UI with explicit
progress or cancellation when the underlying operation supports it.

VST3 controller and editor operations are queued by Tokio and drained in bounded
turns on Electron's main thread. A non-blocking N-API threadsafe-function wake
requests an immediate drain; an unref'd maintenance timer services plug-in and
ARA timers. The embedded runtime must not create or pump a winit event loop,
because Electron already owns the platform application loop.

VST3 results follow the called method's contract. False can decline a capability,
usage hint or layout request; NotImplemented is valid for specific optional
operations. Required lifecycle, complete state and DSP operations still need
successful postconditions, and unknown result codes remain operation failures.
Recognize the explicitly supported SDK-native and COM-compatible encodings;
keep host-originated validation, queue and temporary availability failures
separate from raw SDK results. See
[ADR-0021](adr/0021-vst3-result-contracts.md) for the method policies and
[ADR-0022](adr/0022-vst3-optional-interface-denials.md) for the bounded
False-with-null compatibility allowance in optional interface queries.

VST3 parameter changes reach the audio processor through its bounded parameter
queue and `IAudioProcessor::process`. Enqueue commits the parameter request;
`IEditController::setParamNormalized` only synchronizes the controller UI. A
subsequent controller failure is diagnostic and does not reject the committed
processor change or suppress a requested parameter flush. A real flush failure
retains its own failure outcome. This also applies to processor output parameters
mirrored into the controller. Ozone 11 Exciter exercises this distinction during
Plugin Analysis state cloning and parameter replay. See the
[VST3 controller contract](https://steinbergmedia.github.io/vst3_doc/vstinterfaces/classSteinberg_1_1Vst_1_1IEditController.html).

Bus-arrangement refusal requires reading back the actual layout: a plug-in may
have changed its buses before returning False. Complete state refusal preserves
committed bytes and requires known-state recovery before the affected instance
can resume. Declined controller synchronization does not change whether component
state was accepted, and an existing nonempty controller state cannot silently be
discarded. A temporary control-thread processing pause produces a typed unavailable
block and permits later processing; it does not mark the instance permanently
failed. These rules retain the ownership and failure containment states in
[ADR-0001](adr/0001-runtime-ownership-and-transactions.md).

Concurrent loads of the same VST3 binary share one host context on the owning
UI thread. A factory can retain module-wide callbacks, including the Linux run
loop, so unloading an Analysis measurement clone must not invalidate callbacks
while its lab instance remains loaded. The weak context cache does not extend
the final module lifetime; context teardown still follows library teardown.

Electron main creates one `BaseWindow` per native plug-in editor and registers
its platform handle before sending `OpenPluginEditor`. A sandboxed
`WebContentsView` renders the host-owned toolbar at the top of that window;
Rust creates only the native child container and VST3 view below it. Toolbar
A/B, clipboard, undo/redo, and zoom actions use typed asynchronous control
requests. Tokio routes them through the same bounded UI mailbox, so Electron's
request caller never waits synchronously for plug-in state save or restore
work. Drains are bounded between plug-in calls; an individual third-party VST3
call remains thread-affine and cannot be preempted by the host. Plug-in resize
requests return through a bounded native event queue; Electron sizes the parent
window and reports its content bounds back to Rust. Close ordering is strict:
detach the VST3 view, unregister the host surface, then destroy the Electron
window. Pure Wayland is rejected explicitly; X11, AppKit, and Win32 share this
same ownership protocol. The embedded runtime must never lazily create or pump
a second platform event loop as a fallback. The proposed native Wayland and
XWayland compatibility policy is recorded in
[ADR-0007](adr/0007-linux-editor-compatibility.md); it is not
current architecture until accepted and implemented.

Do not:

- import the addon from renderer or preload;
- add a second audio client addon or helper executable;
- add OS IPC/shared-memory descriptors to native requests;
- call N-API, Electron, or blocking services from an audio callback;
- turn native failures into free-form cross-process protocol errors.
