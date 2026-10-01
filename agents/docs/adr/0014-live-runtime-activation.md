# ADR-0014: Connect layered Live performance to the embedded runtime

- Status: Accepted
- Date: 2026-10-02
- Owners: project maintainers
- Related: [ADR-0001](0001-runtime-ownership-and-transactions.md),
  [ADR-0004](0004-layered-live-documents.md),
  [ADR-0008](0008-root-live-bootstrap-and-capture.md),
  [ADR-0013](0013-live-layer-editing.md)

The scalar-only state restriction below is superseded by
[ADR-0015](0015-live-layer-plugin-state.md), which adds complete layer state and
explicit Capture destinations.

## Context

Live authoring persists Project, Set and Patch scalar overrides. Its isolated
performance controller has no production runtime adapter. Reusing Studio's
desired graph or document mutations would mix persistent edits with temporary
performance values. Existing immediate graph replacement also lacks Live's
bounded cut transition.

## Decision

Use an explicit Live runtime adapter over the existing embedded audio host.
Entering Perform activates Project. Activating a Patch resolves Project, Set
and Patch afresh; selecting an editing scope remains independent. Sets cannot
be activated. Physical audio devices and sample rate are fixed by the Live
document and are not restarted on Patch changes. MIDI instrument routes must
name an enabled physical input; wildcard input does not opt every connected
device into a Live performance.

Every activation loads fresh native plug-in instance IDs, restores complete
state, then applies stable parameter values. Prepare, activate and abort reuse
the existing graph transaction and receipts. The most recent selection wins
until activation is submitted to the native commit boundary. An activation
already submitted is reconciled before another candidate can commit. Publish
the active Patch and generation only after confirmed activation. Known failures
clean up candidate instances and preserve the previous active selection. An
unresolved native outcome quarantines further mutations and retains ownership
until audio has been stopped and cleanup is confirmed.

Live uses an explicit cut activation variant. The callback owns a fixed,
bounded transition with a short outgoing and incoming gain ramp. The outgoing
graph receives note release and sustain release, accepts no new MIDI input,
and is retired through the existing bounded retirement mechanism after its
last render. Ramp state and routing masks are prepared outside the callback.
Ordinary performance Gain, Pan, Mute, Solo, Send level/enable and plug-in enable
changes use runtime parameter controls and do not redeploy the graph.

The renderer sends typed Live commands against the explicit document resource
with operation identity and expected document revision. Perform changes remain
volatile. Activation, adjustment and exit also name the active runtime generation,
so a delayed gesture cannot affect a later Patch. Runtime snapshots map document
plug-in IDs to current generation native IDs; plug-in failure events are accepted
only through that map, and stale outgoing instance events are ignored.
Save writes only the document baseline. Capture preview is a stateful,
replayable operation: it freezes the generation, active Patch, document revision,
sampled values and selectable fields. Selective Capture writes each scalar to
its nearest defining layer in one document transaction and one history entry.
Changes made after the preview stay in the performance overlay.

With the scalar-only layer format, full opaque plug-in state can be captured
only at Project. At a Patch, those fields appear as blocked in the preview;
stable parameter values remain selectable. Writing a Patch's opaque state into
Project would bake inherited parameter overrides into sibling sounds. Full
Patch state Capture requires dedicated layer state persistence in a later step.

Leaving Perform or changing Patch requires an explicit decision about volatile
changes. Selective Capture is completed before retrying that transition;
discard and cancel are separate typed choices. Returning to Edit stops and
releases Live runtime ownership. A quarantined document can close only through
the recovery-preserving path after runtime shutdown. Application audio controls
cannot change the fixed rig during Perform, and Studio recovery must not
republish its graph while a Live document owns the workspace.

Document close retains the working context until worker exit is confirmed.
An ambiguous exit permits only recovery cleanup. After confirmed exit, the close
is committed even if resource or working-copy cleanup fails. Discard marks the
copy ineligible for recovery before removing its database, preventing a partially
removed database from appearing as an available recovery choice.

## Alternatives rejected

- Reusing native instance IDs would retain the outgoing Patch's state.
- Flattening a resolved Patch into Project during Capture would erase the
  ownership of inherited fields.
- Rebuilding the graph for Mute or Solo would release sounding notes during
  ordinary performance gestures.
- Aborting after an ambiguous activation could unload the committed graph.

## Consequences

The implementation remains within the embedded runtime and existing resource
model. Live has a production performance path without claiming that every
layer feature in ADR-0004 is complete. Edit audition, Patch opaque state,
layer-owned entities, document MIDI control bindings and plug-in editor
integration remain separate delivery work. Native build, hardware, click and
soak evidence is required before claiming performance readiness.

## Verification requirements

Evidence must cover fresh resolution, failed and superseded candidates, lost
activation acknowledgements, bounded graph and processor retirement, no
callback allocation, sustained notes at cut, exact device routing, reliable
performance controls, frozen selective Capture across layers, operation replay,
close recovery and Studio/Live ownership transitions. Source implementation or
a successful TypeScript build alone does not establish these outcomes.

## Reconsider when

Patch state persistence, seamless tail-preserving transitions, Live MIDI
bindings or Edit audition are delivered, or measured transition cost requires
a different bounded ramp implementation.
