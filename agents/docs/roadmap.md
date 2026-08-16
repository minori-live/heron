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

1. **Current — Live performance readiness.** Make Heron dependable and
   understandable for a singer-songwriter or livestream performer during a
   two-hour session.
2. **Next — Live project delivery.** Create, author, and perform from a
   standalone `.hrl` document with hierarchical Set/Patch configuration while
   sharing one Mixer domain model with Studio.
3. **Later — Studio creation completion.** Close the composition-to-export path
   without relying on another DAW.

Large feature blocks do not enter Current merely because work has already
started. [The Live performance contract](product-live.md) is the authority for
Current scope and release evidence.

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

## Current — Live performance readiness

### Outcome

A DAW-experienced singer-songwriter or livestream performer can create or open
a project, configure one microphone, one instrument, and multiple MIDI
controllers, build a monitored plug-in and mixer signal chain, play prepared
audio or MIDI material, understand system health, and keep the session running
for at least two hours without reading source or developer documentation.

### Workflow and interaction

- [ ] A DAW-experienced user completes the canonical Live task within 30
      minutes using existing DAW knowledge and in-product copy only.
- [ ] Mixer behavior follows Logic Pro unless a documented decision explicitly
      defines an exception.
- [ ] Send level is directly adjustable on the channel strip; routing, tap,
      enablement, and deletion remain available as secondary configuration.
- [ ] Frequently read or adjusted state is not hidden behind a menu or popover.
- [x] The project asset library browses audio and MIDI already in the project
      and imports both formats.
- [x] MIDI can be dropped on an empty arrangement area, dropped on an existing
      Instrument track, or passed through the import-mapping dialog.
- [x] Audio becomes available for audition after import; pre-import audition,
      disk-wide browsing, and library indexing do not block this milestone.
- [ ] User-facing health information follows the status, detail, notification,
      blocking-decision, and diagnostic layers in
      [Interaction design](interaction-design.md).

### External MIDI control

- [x] Existing note routing, controller routing to instruments, and application
      command bindings remain available.
- [x] System preferences map a device ID and MIDI message to Mixer Gain, Pan,
      Mute, or Solo. Sends are not MIDI targets in Current.
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

- [ ] A lost audio device immediately opens a recovery decision while Heron
      continues trying the previous device in the background.
- [ ] A user's subsequent device choice wins over every earlier reconnect
      attempt, even if the old device has already returned.
- [ ] A recoverable plug-in initialize, restore, processing, editor, or state
      failure bypasses or disables only the affected instance without
      invalidating the rest of the graph. The supported boundary and required
      recovery guarantees are defined in
      [ADR-0011](adr/0011-in-process-plugin-failure-containment.md).
- [ ] CPU pressure, XRUNs, and overload are visible to the user, but Heron does
      not change buffer size, bypass effects, or otherwise alter the performance
      without an explicit user action.
- [ ] A fatal in-process plug-in or native failure may restart Heron. Plug-in
      process isolation is not part of Current because it would break the
      existing ARA ownership model.
- [ ] The UI distinguishes a contained instance failure from a fatal native
      failure and never claims that access violations, aborts, deadlocks, or
      other non-returning third-party calls can be isolated in process.
- [ ] Relaunch preserves the existing user choice between the saved project and
      the recoverable working copy.
- [ ] Existing recording and playback of prepared accompaniment do not regress,
      although new recording workflows are not part of the Live exit criteria.

### Release evidence

- [ ] Windows passes the Live matrix with a 64-bit vendor ASIO driver.
- [ ] macOS passes the Live matrix with CoreAudio.
- [ ] Linux passes the Live matrix with ALSA.
- [ ] VST3 is release-blocking on all three platforms; ARA must not regress.
      CLAP does not block this milestone, and AU remains deferred.
- [ ] A manually triggered automated two-hour soak runs through the mock-device
      Live scenario without an unbounded resource trend, graph corruption, or
      unexplained XRUN growth.
- [ ] A two-hour real-hardware session passes on every release platform. These
      hardware runs belong to the release process, not ordinary CI.
- [ ] Real target users complete the canonical task within 30 minutes. This is
      a documented product metric, not an automated test substitute.

### Governance work before feature expansion

- [x] Adopt the engineering, architecture, interaction, and ADR rules linked
      from `agents/docs/README.md`.
- [x] Resolve the source-size violations recorded in
      [Engineering standards](engineering-standards.md) and enable the hard
      size gate in the default lint pipeline.
- [ ] Add enforceable architecture checks wherever a rule can be checked
      mechanically; issue-linked exceptions must not expand silently.
- [ ] Reconcile user-facing documentation with the behavior in the development
      build before the next release.

## Next — Live project delivery

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

Next exits only after the complete journey works on every supported release
platform, archive and activation failures preserve the documented recoverable
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
