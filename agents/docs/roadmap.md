# Product roadmap

Heron's roadmap is ordered by complete user outcomes, not by the number of
implemented subsystems. A capability belongs in **Current capabilities** only
after its implementation, tests, documentation, and required human evidence
all satisfy the definition of done below.

Heron remains experimental. Before 1.0, project archives, preferences, and
internal protocols may change without a migration guarantee. A change still
has to preserve the single-commit, typed-error, and recovery rules documented
for the affected boundary.

## Product sequence

1. **Closed in v0.5.0 — Live performance readiness.** Make Heron dependable and
   understandable for a singer-songwriter or livestream performer during a
   two-hour session.
2. **Current — Live project delivery.** Create, author, and perform from a
   standalone `.hrl` document with hierarchical Set/Patch configuration while
   sharing one Mixer domain model with Studio.
3. **Later — Studio creation completion.** Close the composition-to-export path
   without relying on another DAW.

Large feature blocks do not enter Current merely because work has already
started. [The Live performance contract](product-live.md) defines the accepted
performance baseline. Current scope is Live project delivery below, including
the work carried forward from v0.5.0, with its architecture defined by
[ADR-0012](adr/0012-separate-layered-live-documents.md).

## Definition of done

A roadmap item is done only when all applicable evidence exists in the same
change or release candidate:

- the user-visible behavior and failure states are implemented;
- tests match the risk matrix in [Engineering standards](engineering-standards.md);
- public documentation describes behavior that has actually shipped;
- agent-facing architecture and interaction documents match the implementation;
- supported keyboard, focus, theme, localization, and accessibility states pass;
- cross-process or real-time changes satisfy their boundary-specific checks;
- no linked blocking defect or architecture-policy violation remains; and
- any required manual hardware, soak, or usability evidence has been recorded.

Checking off an internal API, component, or protocol is not sufficient when the
user journey still breaks. Partially implemented work remains in Current or
Backlog with its missing exit conditions stated explicitly.

## Current capabilities

These capabilities form the existing experimental baseline. They are not a
claim that the Live or Studio journey is complete.

- Embedded native audio runtime with cpal device streams and a format-neutral
  plug-in graph.
- Project create, open, save, working-copy recovery, and recording-media
  recovery.
- Arrangement playback with audio and MIDI clips, editing, loop, count-in, and
  project commands with undo.
- Audio and MIDI recording, including MIDI hardware input, hot-plug state,
  external MIDI Clock, and journal recovery.
- Mixer channels, buses, outputs, sends, meters, Master, and plug-in chains.
- VST3 instruments and effects, editor windows, state persistence, and ARA 2.
- Offline full-mix export.
- A right-side project Media Browser for searchable audio/MIDI assets, canonical
  WAV/BWF/MP3/FLAC and MIDI import, arrangement drop, and transport-independent
  audio audition.
- A single-output low-latency mode with latency budgeting and explicit bypass
  policy.
- Cross-platform development builds for Windows, macOS, and Linux.

## Closed in v0.5.0 — Live performance readiness

Closed by maintainer decision on 2026-09-06, effective with v0.5.0, based on the
manual acceptance recorded below. Unfinished governance, documentation,
automated validation, and evidence-record work moves to Live project delivery.
Those tasks remain unchecked in the successor milestone; closure does not
claim that the outstanding checks or evidence collection were completed.

### Outcome

A DAW-experienced singer-songwriter or livestream performer can create or open
a project, configure one microphone, one instrument, and multiple MIDI
controllers, build a monitored plug-in and mixer signal chain, play prepared
audio or MIDI material, understand system health, and keep the session running
for at least two hours without reading source or developer documentation.

### Workflow and interaction

- [x] A DAW-experienced user completes the canonical Live task within 30
      minutes using existing DAW knowledge and in-product copy only.
      Manual acceptance confirmed by the maintainer on 2026-09-06 for all
      steps presented in the usability review. The tested build/platform,
      exact elapsed time, and observations were not supplied; the detailed
      release evidence and two-hour hardware sessions remain separate checks.
- [x] Mixer behavior follows Logic Pro unless a documented decision explicitly
      defines an exception.
      Manual comparison confirmed by the maintainer on 2026-09-06, covering
      channel strips, routing, Sends, plug-in operations, and drag, keyboard,
      reset, and cancellation gestures. Automated tests were inspected but
      could not run in the review checkout because dependencies were missing
      and the local pnpm store could not be opened.
- [x] Send level is directly adjustable on the channel strip; routing, tap,
      enablement, and deletion remain available as secondary configuration.
      Manual interaction check confirmed by the maintainer on 2026-09-06.
      Source review confirms the direct knob and secondary configuration;
      the user manual now describes both. Automated execution remains pending
      the review checkout's dependency setup described above.
- [x] Frequently read or adjusted state is not hidden behind a menu or popover.
      Manual Live-workflow visibility check confirmed by the maintainer on
      2026-09-06, covering readability and access to frequent controls and state.
- [x] The project asset library browses audio and MIDI already in the project
      and imports both formats.
- [x] MIDI can be dropped on an empty arrangement area, dropped on an existing
      Instrument track, or passed through the import-mapping dialog.
- [x] Audio becomes available for audition after import; pre-import audition,
      disk-wide browsing, and library indexing do not block this milestone.
- [x] User-facing health information follows the status, detail, notification,
      blocking-decision, and diagnostic layers in
      [Interaction design](interaction-design.md).
      Manual health-information check confirmed by the maintainer on
      2026-09-06, covering presentation layers, warning impact and safety copy,
      and user-controlled remedies.

### External MIDI control

- [x] Existing note routing, controller routing to instruments, and application
      command bindings remain available.
- [x] System preferences map a device ID and MIDI message to Mixer Gain, Pan,
      Mute, or Solo. Sends are not MIDI targets in this milestone.
- [x] Mixer targets resolve against the current shared ordering of Audio,
      Instrument, BUS, Output, and Master channels. Reordering intentionally
      changes which channel an ordered target controls.
- [x] Mute and Solo bindings can choose toggle or absolute behavior.
- [x] A plug-in instance can receive a project-unique `controlAlias` while its
      display name remains non-unique.
- [x] System preferences map MIDI controls to an arbitrary plug-in parameter by
      `controlAlias`; moving the instance between channels does not break the
      mapping.
- [x] Missing ordered Mixer targets and missing plug-in aliases ignore input
      without retargeting another plug-in.
- [x] A disconnected controller retains mappings by device ID until the user
      changes them.

### Runtime resilience

- [x] A lost audio device immediately opens a recovery decision while Heron
      continues trying the previous device in the background.
      Manual device-loss check confirmed by the maintainer on 2026-09-06:
      disconnecting the active interface opens the recovery decision with
      usable replacements; reconnecting the original restores audio while
      keeping the decision available.
- [x] A user's subsequent device choice wins over every earlier reconnect
      attempt, even if the old device has already returned.
      Both manual precedence cases confirmed by the maintainer on 2026-09-06:
      selecting replacement B before original A reconnects keeps B active;
      selecting B after A has resumed audio switches to B and keeps it active.
- [x] A recoverable plug-in initialize, restore, processing, editor, or state
      failure bypasses or disables only the affected instance without
      invalidating the rest of the graph. The supported boundary and required
      recovery guarantees are defined in
      [ADR-0011](adr/0011-in-process-plugin-failure-containment.md).
      Manual containment check confirmed by the maintainer on 2026-09-06 for
      initialization, state restore/save, processing, and editor failures:
      the affected slot exposes failure and recovery, unrelated paths continue,
      failed effects provide dry audio, failed instruments remain silent, and
      routing and last committed state remain intact. Fatal native failures
      remain a separate check.
- [x] CPU pressure, XRUNs, and overload are visible to the user, but Heron does
      not change buffer size, bypass effects, or otherwise alter the performance
      without an explicit user action.
      Manual load-response check confirmed by the maintainer on 2026-09-06:
      warnings and counters appear under load without automatically changing
      buffer size, effect bypass, or routing.
- [x] A fatal in-process plug-in or native failure may restart Heron. Plug-in
      process isolation is not part of Current because it would break the
      existing ARA ownership model.
      Controlled fatal-failure test and successful subsequent launch confirmed
      by the maintainer on 2026-09-06. Saved-project versus working-copy
      recovery remains a separate check.
- [x] The UI distinguishes a contained instance failure from a fatal native
      failure and never claims that access violations, aborts, deadlocks, or
      other non-returning third-party calls can be isolated in process.
      Manual messaging check confirmed by the maintainer on 2026-09-06:
      contained failures identify the plug-in and recovery action, fatal
      failures are treated as application failures, and the UI makes no
      unsupported native-crash or non-returning-call containment claims.
- [x] Relaunch preserves the existing user choice between the saved project and
      the recoverable working copy.
      Manual recovery-choice check confirmed by the maintainer on 2026-09-06:
      recovering the working copy restores newer changes, opening the saved
      archive restores the saved version, and cancellation leaves both copies
      unchanged.
- [x] Existing recording and playback of prepared accompaniment do not regress,
      although new recording workflows are not part of the Live exit criteria.
      Manual regression check confirmed by the maintainer on 2026-09-06 for
      audio and MIDI recording, take finalization/recovery, recorded and
      imported accompaniment playback, and save/reopen.

### Release evidence

The maintainer confirmed on 2026-09-06 that the full Live matrix and two-hour
real-hardware sessions passed on Windows with a 64-bit vendor ASIO driver,
macOS with CoreAudio, and Linux with ALSA, with no unexplained XRUN growth or
unbounded resource growth. Build identifiers, device/driver versions, buffer
sizes, sample rates, plug-in versions, and measured resource/XRUN totals were
not supplied; detailed release-candidate evidence collection is carried into
Live project delivery.

- [x] Windows passes the Live matrix with a 64-bit vendor ASIO driver.
- [x] macOS passes the Live matrix with CoreAudio.
- [x] Linux passes the Live matrix with ALSA.
- [x] VST3 is release-blocking on all three platforms; ARA must not regress.
      CLAP does not block this milestone, and AU remains deferred.
      VST3 is covered by the confirmed platform matrix; the maintainer also
      confirmed existing ARA workflows pass without regression on Windows,
      macOS, and Linux on 2026-09-06.
- [x] A manually triggered automated two-hour soak runs through the mock-device
      Live scenario without an unbounded resource trend, graph corruption, or
      unexplained XRUN growth.
      Source review on 2026-09-06 found that `soak:device-recovery` exercises
      reconnect cycles and generation progression, but does not exercise a
      representative Live graph or measure resource/XRUN trends. Its result
      alone does not establish this exit criterion.
      The maintainer subsequently confirmed that the broader two-hour
      mock-device Live run passed, including graph integrity and resource/XRUN
      monitoring. The runner and result artifact were not supplied.
- [x] A two-hour real-hardware session passes on every release platform. These
      hardware runs belong to the release process, not ordinary CI.
- [x] Real target users complete the canonical task within 30 minutes. This is
      a documented product metric, not an automated test substitute.
      Covered by the maintainer's 2026-09-06 manual acceptance of the canonical
      target-user task recorded under Workflow and interaction above.

### Completed governance work

- [x] Adopt the engineering, architecture, interaction, and ADR rules linked
      from `agents/docs/README.md`.
- [x] Resolve the source-size violations recorded in
      [Engineering standards](engineering-standards.md) and enable the hard
      size gate in the default lint pipeline.

## Current — Live project delivery

This successor milestone owns all unfinished work from the v0.5.0 closure as
well as the standalone Live-document outcome below.

### Work carried forward from v0.5.0

Tracked in [issue #135](https://github.com/minori-live/heron/issues/135).

- [ ] Add enforceable architecture checks wherever a rule can be checked
      mechanically; issue-linked exceptions must not expand silently.
      Review on 2026-09-06 found existing gates for native imports, IPC wrappers,
      main-domain dependencies, database access, UI ownership, source size, and
      real-time allocations. The task-boundary and source-size policy tests
      passed locally; the source-size gate reports zero hard violations.
      Remaining enforcement gaps include shared-package dependency direction
      and validation of issue-linked, bounded policy exceptions.
- [ ] Complete automated validation deferred during the closure review,
      including Mixer, shared-control, architecture, and UI checks. Restore the
      project-managed dependency setup and record the results; inspection and
      manual acceptance do not substitute for the pending automated runs.
- [ ] Reconcile user-facing documentation with the behavior in the development
      build before the next release. The Send instructions were corrected
      during closure review; the remaining manual still needs reconciliation.
- [ ] Attach the detailed release evidence behind the confirmed platform,
      hardware, and usability passes: build identifiers, operating-system and
      device/driver versions, buffer sizes, sample rates, plug-ins, resource
      and XRUN measurements, setup times, and user-test observations, as
      specified in [the Live contract](product-live.md#evidence-record).
- [ ] Make the confirmed broader mock-device Live soak reproducible from the
      repository and attach its runner and result artifact. Close the coverage
      gap in `soak:device-recovery` or link the broader runner, including a
      representative Live graph and resource/XRUN trend checks.

### Outcome

A performer completes the path below with a standalone, recoverable Live
document:

```text
create or import Live project -> configure exact audio and MIDI devices
-> author Project / Set / Patch layers -> enter Perform Mode
-> switch root and Patches safely -> capture intended changes -> save
```

The architecture and ownership contract is defined by
[ADR-0012](adr/0012-separate-layered-live-documents.md). The milestone includes:

- `.hrs` as the default extension for new Studio documents while `.heron`
  remains an equally supported Studio extension;
- independent `.hrl` create, open, save, working-copy recovery, schema,
  template, and migration paths;
- one-time full Mixer import from a Studio document when creating a Live
  document, without linking, synchronization, or merge;
- fixed Project, Set, and Patch ownership, field-level inheritance, validated
  Copy, and recursive dependency-aware deletion;
- strict project-owned audio and MIDI device configuration plus hierarchical,
  additive MIDI bindings;
- distinct Edit and Perform modes, runtime override capture, and deterministic
  root/Patch resolution;
- atomic Patch activation with stale-generation protection, failure rollback,
  and the initial bounded `cut` transition policy; and
- a minimum useful declarative performance UI whose concrete persisted schema
  is refined before implementation and cannot contain executable content.

This milestone exits only after the carried-forward work is complete and the
complete journey works on every supported release platform, archive and
activation failures preserve the documented recoverable
state, and a real target user can prepare and complete a representative
performance without editing a Studio timeline.

## Later — Studio creation completion

### Outcome

A user completes the path below without another DAW:

```text
create project -> configure devices -> record MIDI or simple audio
-> edit -> load instruments and effects -> mix -> export a playable file
```

This milestone follows Live project delivery. Candidate scope includes
composition depth, recording usability, automation, grouping, stem export, and
the editing details exposed by real-user tests. Existing implementations are
inputs to that planning; they are not automatically considered complete.

## Backlog without schedule

The following work may be refined or landed opportunistically, but it must not
displace Current unless a documented dependency proves that it blocks the Live
outcome:

- channel and plug-in automation, mixer grouping, and stem export;
- full CLAP conformance and platform coverage;
- Audio Unit hosting;
- Mackie Control, HUI, MIDI soft takeover, motor-fader feedback, controller
  displays, and Send MIDI targets;
- indexed disk libraries, favorites, tags, metadata search, and pre-import
  audition;
- dedicated JACK, PipeWire, and PulseAudio backends;
- native Wayland plug-in editor support under the capability and acceptance
  policy proposed in
  [ADR-0006](adr/0006-tier-linux-plug-in-editor-compatibility.md);
- signed and notarized distribution;
- the shared iced plug-in visual language and a broader built-in processor and
  instrument rack.
