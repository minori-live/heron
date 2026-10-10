# ADR-0030: EQ graph and fixed band controls

- Status: Accepted
- Date: 2026-10-08
- Owners: project maintainers
- Scope: native Heron EQ editor layout, parameter gestures and response previews
- Related: [ADR-0029](0029-native-heron-eq.md)

## Context

Heron EQ supports direct curve editing with at most 24 bands. The frequency
display needs enough space for selecting nodes, comparing spectra and shaping
the response. Selected-band controls and secondary settings must remain
accessible without crowding the graph or moving during a parameter gesture.

## Decision

The frequency display occupies the space between a compact top bar and bottom
bar. Undo/redo, preset management and A/B comparison belong to Heron's host
rather than a second set of controls inside Heron EQ. Processing mode,
analyzer and output belong at the bottom. Secondary
settings appear in exclusive floating menus and never resize the display.

Common actions use vector icons with task-specific hover tooltips. The top bar
provides the Tools ellipsis; the footer
provides power/bypass and spectrum/analyzer icons.
Processing mode keeps its current name beside its icon, and
output keeps its gain-scale percentage and dB readout beside the speaker icon.
Shape, channel, units and Pre/Post/External labels remain text. Active icons
use the selected color and background; unavailable actions are dimmed and do
not publish messages. Headphones mean band solo, trash means delete, and the
close cross dismisses its panel or operation notice. Icon drawing introduces
no new gesture or editor-session ownership.

The native EQ editor does not expose local undo/redo, drawing, A/B states,
Copy A/B or a file/clipboard preset panel. Band copy/paste remains available. Heron's
current project save/restore persists opaque VST3 component/controller state;
this does not establish a host preset browser or full portable-preset import.
The native Tools menu's clipboard icon (Paste bands) can read portable EQ Fit JSON and
append its bands while retaining destination globals. Applying a fit therefore
uses a new empty Zero Latency instance, band paste and a separate Overall Gain
setting; a zero-band fit needs only the gain setting. The versioned numerical
contract remains intact without adding whole-preset management to the EQ.

Spectra use log-frequency power smoothing and bounded cubic drawing, with a
thin Pre trace and a filled Post trace. The right axis shows spectrum dBFS;
the left axis shows EQ gain in dB. A compact color legend identifies the traces.
Display smoothing never changes the raw spectra used by matching or peak
measurement, and frozen spectra retain both forms from the same capture.
Only the current instance's Pre/Post and its routed sidechain External spectrum
are displayed. EQ Match uses the current instance's sidechain measurements;
there is no live-instance list, cross-instance overlay, reference chooser or
cross-editor control. The previous cross-instance interaction contract is
retired. Band clipboard transfer remains available. Menus reserve the plot's
axis margins, and band controls reserve its frequency labels. The graph omits
frequency-limit annotation, and grid labels must have enough spacing to avoid overlap.

An operation may show one optional, closeable notice. It is rendered once,
independently of menu bodies and numeric fields. Close or Escape clears it;
opening another menu or starting a new Match also clears the previous notice.
Dismissal does not publish parameters or end an active host edit. A failed
sidechain Match leaves the EQ, output settings, selection and existing gesture
unchanged, with no parameter apply. A successful candidate is validated at the
current sample rate before one atomic settings commit and selection reset.
There is no local history entry or rollback command to repair a failed Match.

Opening an editor starts without a selected band. Selecting a curve node shows
a compact panel with shape, channel and frequency/gain/Q rotary controls at a
fixed lower-center position. It never follows the selected frequency or moves
when frequency/gain changes. Clicking the empty display deselects bands and hides
the panel. MIDI learning and secondary band actions open on demand above the
panel. Rotary controls keep their widget identity and layout during edits and
while secondary settings open/close, preventing hover and drag state from
flickering. The earlier node-following placement is retired.

Resizing a native-scaled plug-in retains its mouse client coordinates: its
editor owns the new layout and content-scale conversion. The Windows host must
not remap those coordinates from the previous child-window extent to the new
extent, including while the editor's resize is deferred until its next frame.
Forced-size mouse remapping belongs only to the Windows platform-scaling
fallback. An unchanged extent or replacement child window must not retain a
stale transform in the native-scaled path.

For the Windows embedded editor, an announced host content scale includes
both display DPI and additional host zoom. That scale governs native window
size, rendering and mouse conversion together; later display DPI notifications
must not overwrite it or resize the child to an OS-suggested rectangle. The
host owns the accepted physical extent, while the editor applies queued
logical resizes at the current content scale. Standalone windows and embedded
windows without an announced content scale retain their system DPI policy.
The pinned Truce/baseview dependency patches implement this existing ownership
rule; their versions and original source provenance remain recorded alongside
the vendored copies.

EQ bands use static filters. Dynamic EQ, spectral dynamics, their controls and
local drawing/history workflows are removed from the processor/editor contract.

Only low cut, high cut and band pass expose a dB/oct control. The fitter's Bell
and shelf settings describe one second-order RBJ filter through frequency, gain
and Q. A stored transition setting of 12 selects this native baseline; it does
not establish a Bell's asymptotic attenuation slope. Non-cut cascaded states
remain readable without silently changing their saved audio behavior.

The static response preview follows editable intent immediately in Zero
Latency and Natural Phase. Linear Phase uses the exact finite FIR prepared by
the bounded, latest-only editor worker in ADR-0029; its total curve is withheld
while the current kernel is pending or failed. An older kernel or ideal FIR
must not stand in for the new target. Trim, pan and mute update immediately
against the cached kernel. Automatic gain uses the latest measured compensation
until new audio arrives. This preview describes the edit target; actual Pre/Post,
latency and processing pending/failure status remain owned by audio's accepted
processor. Solo uses measured Post rather than a static total transfer.

Dragging nodes adjusts frequency and gain. Dragging rotary controls adjusts
one parameter, retaining the initial frequency/Q ratios or gain offsets of a
multi-band selection. A completed drag balances host edit notifications; history
belongs to the host. Wheel steps and numeric submissions likewise commit
once. Numeric fields receive focus when opened; text editing cannot delete
bands through global shortcuts. Without an operation notice, Escape cancels the
active gesture; focus loss also cancels it. Cancellation clears local pointer
intent so later motion cannot revive it, and publishes a correction to any
pending host value even when the authoritative
parameter cache still equals the initial value. The VST3 bridge writes local
parameters synchronously; GUI notifications are then queued through the host.
The host coalesces these block-start GUI values by parameter, retaining the
latest value and deferring values that cannot fit in the current block. Rapid
drag updates must not exhaust a parameter queue and discard the final
cancellation value. Sample-offset automation keeps its separate event order.
State capture finishes admitted GUI values on the paused control thread before
serialization, stopping on the first processing error. Its prepared GUI flush
storage does not consume scheduled automation for the next audio block. The
audio callback keeps one bounded drain with prepared storage and no locks.

Empty-display presses become rectangle selections only after the drag
threshold. Right-clicking a node opens its context menu. Alt-click bypasses that
band; Alt-drag auditions it until release/cancellation. These gestures retain
the local revocable editor-session boundary from ADR-0029. Audition is owned by
that editor's generation, including before any parameter movement. Closing the
editor revokes its audition and balances its host gestures; delayed UI destruction
can release only that generation and cannot stop a newer editor's audition.

## Alternatives

The persistent inspector and all-settings toolbar were rejected because they
reduced graph space and added unnecessary steps to curve editing. A separate
renderer web editor was rejected because the existing native editor and host
gesture/session ownership already provide this boundary.

## Consequences and verification

Controls are contextual and some settings require opening a menu. Algorithms,
stable parameter slots, audio threading and saved-state compatibility remain those
of ADR-0029. Audio processing and interaction behavior each require their own
verification.

Validate public canvas gestures, grouped rotary gestures, host edit balance,
parameter publication and cancellation. Check that a failed Match leaves
settings, selection and active edits untouched, and that its single notice can
be dismissed without writing parameters. Verify preview updates without new
audio samples, current-generation FIR publication and immediate output edits
without redesigning the kernel. Inspect processor-fed native screenshots at
1120 × 760 and the minimum 1040 × 700, including no selection, a selected band,
24 bands, numeric editing and each secondary menu. Verify that opening a menu
does not reflow the graph, band controls retain their lower-center location
during gain/frequency changes, and axis labels remain readable.

Verify resize routing through the same live Windows attachment, growing,
shrinking and repeating an accepted size before clicking and dragging the
relocated controls. The packaged regression command is
`cargo test -p heron-eq --features rt-paranoid --test vst3_resize -- --ignored --nocapture`.
The 2026-10-08 run passed at the observed 200% system DPI and 100% host zoom;
this does not establish arbitrary host-zoom negotiation. Same-cache GPU evidence
must also retain the real widget tree across sizes and check control painting,
pointer hits, Gain changes and menu dismissal. That layout evidence complements
the attachment regression; it does not prove HWND mouse routing by itself.

Reconsider if a required workflow cannot remain usable through contextual
controls or if accessibility needs require an additional equivalent surface.
