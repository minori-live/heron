# Renderer UI audit

This checklist records the source-wide audit introduced with `@heron/ui`. The inventory is
collected dynamically. `lint:design` covers tokens and visual-source rules;
`lint:ui-boundary` covers the stronger interaction ownership contract and requires a zero baseline.

All visible interaction, including musical/two-dimensional gestures, is now represented by a
public Storybook component. Desktop retains passive rendering and domain conversion, while focus,
keyboard, pointer, drag/drop, resize, cancellation, and interaction-state styling are UI-owned.

## UnoCSS migration classification (2026-08-18)

The Desktop renderer and public UI exports fall into three ownership groups:

1. **Utility-owned structure.** Ordinary flex/grid layout, spacing, sizing, overflow, typography,
   and simple chrome were migrated in `UiButton`, `UiCheckbox`, `UiDialog`, `UiEmptyState`,
   `UiField`, `UiIconButton`, `UiLoadingState`, `UiNumberInput`, `UiPopover`, `UiProgress`,
   `UiSectionHeading`, `UiSelect`, `UiSpinner`, `UiStatusNotice`, `UiSurface`, `UiTextInput`,
   `UiToolbar`, and `UiTooltip`. Desktop migration covers `AppChrome`, `AppRouteView`, Splash,
   the settings containers, `StudioWorkspace`, `StudioTopbar`, `StudioStatusbar`,
   `ArrangementWorkspace`, and `MixerConsole`.
2. **UI-owned domain interaction.** Mixer controls, faders, meters, clips, notes, rulers, global
   lanes, drag/drop, resize, node graphs, and guided tours are Storybook components. Desktop passes
   view models and handles typed intents.
3. **No local visual ownership.** Route views, hosts, providers, logos, and controller-only
   components without ordinary local layout remain composition/API boundaries and require no
   utility conversion.

This classification applies to every Vue file in the scanned roots. `lint:ui-boundary` rejects
native interactive templates, DOM gesture code, direct third-party imports, Desktop interaction
CSS, and any mismatch between public Vue exports and the Storybook catalog.

## Application and views

- [x] `App.vue` — `UiProvider`; application lifecycle remains in stores.
- [x] `views/WelcomeView.vue` — composition surface.
- [x] `views/StudioView.vue` — composition surface; renderer/store/preload boundary unchanged.
- [x] `views/SystemSettingsView.vue` — composition surface.
- [x] `views/ProjectSettingsView.vue` — composition surface.

## Overlays, feedback, and workflows

- [x] `components/dialog/GlobalDialogHost.vue` — queue controller + `UiAlertDialog`.
- [x] `components/operations/GlobalOperationHost.vue` — controller + `UiDialog`.
- [x] `components/operations/OperationProgressDialog.vue` — `UiProgress`, notice, and action.
- [x] `components/benchmark/AudioBenchmarkHost.vue` — controller + `UiDialog`.
- [x] `components/benchmark/AudioBenchmarkDialog.vue` — pure benchmark presenter.
- [x] `components/midi/MidiImportDialog.vue` — shared dialog and feedback behavior.
- [x] `components/recording/PendingRecordingHost.vue` — controller + shared dialog/actions.
- [x] `components/performance/PerformanceMonitorPopover.vue` — shared popover boundary.

## Welcome and settings

- [x] `components/project/ProjectWelcome.vue`.
- [x] `components/settings/SettingsContainer.vue`.
- [x] `components/settings/SettingsPage.vue`.
- [x] `components/settings/SettingsSection.vue`.
- [x] `components/project-settings/ProjectGeneralSettings.vue`.
- [x] `components/project-settings/ProjectSettingsPage.vue`.
- [x] `components/system-settings/AudioDeviceSettings.vue` — shared select/radio controls.
- [x] `components/system-settings/AudioRuntimeSettings.vue`.
- [x] `components/system-settings/DisplaySettings.vue`.
- [x] `components/system-settings/MixerDisplaySettings.vue`.
- [x] `components/system-settings/RecordingSettings.vue`.
- [x] `components/system-settings/SystemSettingsPage.vue`.

## Mixer and plug-ins

- [x] `components/mixer/MixerConsole.vue`.
- [x] `components/mixer/MixerChannelStrip.vue` — domain strip retained; sections audited.
- [x] `components/mixer/MixerChannelMenu.vue` — shared popover.
- [x] `components/mixer/MixerInputSection.vue` — shared popover.
- [x] `components/mixer/MixerOutputSection.vue` — shared popover.
- [x] `components/mixer/MixerSendSection.vue` — shared popovers; gesture controls retained.
- [x] `components/mixer/MixerPluginPicker.vue` — shared popover.
- [x] `components/mixer/MixerPluginSection.vue`.
- [x] `components/mixer/MixerPanKnob.vue` — keyboard-capable domain knob retained.
- [x] `components/mixer/MixerDbScale.vue`.
- [x] `components/mixer/MixerSectionLabels.vue`.
- [x] `components/plugins/InstrumentSlot.vue`.
- [x] `components/plugins/PluginRack.vue`.
- [x] `components/plugins/PluginSlot.vue`.

## Studio and arrangement

- [x] `components/studio/StudioWorkspace.vue` — local two-dimensional workspace.
- [x] `components/studio/StudioTopbar.vue` — shared tooltips.
- [x] `components/studio/StudioStatusbar.vue`.
- [x] `components/studio/StudioPlaceholderPanel.vue`.
- [x] `components/media-browser/MediaBrowserPanel.vue` and
      `components/studio/RightPanelHost.vue` — project asset filtering, local scrolling,
      mutually exclusive right-panel ownership, and keyboard resizing.
- [x] `components/studio/EngineInspector.vue` — shared slider/action.
- [x] `components/studio/ArrangementWorkspace.vue` — local two-dimensional scrolling retained.
- [x] `components/studio/ArrangementTrack.vue`.
- [x] `components/studio/MidiArrangementTrack.vue`.
- [x] `components/studio/AudioClipCard.vue`.
- [x] `components/studio/ArrangementZoomControls.vue`.
- [x] `components/studio/TimelineRuler.vue`.
- [x] `components/studio/WaveformCanvas.vue`.
- [x] `components/studio/TrackGainControl.vue` — domain gesture control.
- [x] `components/studio/TrackPanControl.vue` — domain gesture control.
- [x] `components/studio/TrackQuickControls.vue`.
- [x] `components/studio/TrackHeightResizeHandle.vue`.
- [x] `components/studio/ChannelFormatIcon.vue`.
- [x] `components/studio/global-lanes/GlobalLaneHeader.vue`.
- [x] `components/studio/global-lanes/GlobalValueLane.vue`.
- [x] `components/studio/global-lanes/TempoTrackLane.vue`.

## Editors and expanded workflows

- [x] `components/piano-roll/PianoRollDock.vue` — editor composition and focus boundary.
- [x] `components/piano-roll/PianoRollToolbar.vue` — shared toolbar, exclusive tool group, and
      signal-rail clip choices.
- [x] `components/piano-roll/PianoRollInspector.vue` — shared inline fields and bounded numeric
      inputs.
- [x] `components/piano-roll/PianoRollGrid.vue` — domain grid retained; shared recording signal
      token.
- [x] `components/piano-roll/PianoRollKeyboard.vue`.
- [x] `components/piano-roll/PianoRollNote.vue`.
- [x] `components/piano-roll/PianoRollVelocityLane.vue`.
- [x] `components/effect-graph/CompiledEffectGraphHost.vue` — product controller.
- [x] `components/effect-graph/CompiledEffectGraphPanel.vue` — domain graph surface retained.

## Shared editing

- [x] `components/InlineTrackNameEditor.vue`.

## Automated gates

### Refactor equivalence

Moving an interaction into the catalog is not permission to redesign it. Compare
against the pre-boundary-refactor implementation (`14f0156`) as well as the
interaction-design contract. A passing export/catalog audit alone does not prove
visual or behavioral equivalence.

The alignment regression suite checks these observable contracts:

| Surface            | Contract                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Track volume       | A 15px horizontal fader over an 11px meter well; live meter data is independent of gain and the well remains visible at silence. Native thumb geometry and its hit area must agree.        |
| Track pan          | A 23px control, two pixels per pan unit, and double-click numeric editing. Do not substitute the standard mixer's reset gesture.                                                           |
| Mixer inserts      | Resting names occupy the full row; hover or keyboard focus reveals compact actions without overlapping the title. Test composition layout, not just emitted clicks.                        |
| Mixer gain readout | Editing fits the 34×20px readout, starts from the raw numeric gain even when the label is −∞, and restores keyboard focus on commit/cancel.                                                |
| Settings           | Navigation icons and neutral surfaces must survive composition. Input backgrounds and derived focus-ring tokens also need the neutral scope; changing only sidebar colors is insufficient. |
| Clip editing       | Audio headings remain visible, fade handles sit above trim handles, MIDI trim affordances remain visible on selection, and Escape cannot be followed by a pointer-up commit.               |
| Resize             | Every keyboard step starts from the current controlled value. Cancellation restores the pre-drag size; unrelated pointers cannot finish a gesture.                                         |
| Piano roll erase   | Sweeping uses grid-coordinate note hit testing while pointer capture is active, then commits the collected deletion once.                                                                  |
| File import        | Accept the `Files` drag type during protected dragover, before the browser exposes the actual files on drop.                                                                               |

`apps/design-system/tests/ui-alignment.spec.ts` verifies rendered bounds, hit
testing, input paths, focus and reflow in Chromium. UI/renderer tests cover the
normalized intent and domain mappings. The Electron lifecycle test also checks
the composed settings icons/palette and audio clip/fader display. Keep these
checks complementary; stubbed components cannot validate composed layout.

### Static boundaries

- No renderer import from `reka-ui`.
- No manual renderer `Teleport` overlay.
- No Histoire dependency or script.
- No raw renderer color.
- No numeric renderer z-index.
- No undefined shared token reference; the `--ui-` namespace resolves only through shared token
  sources.
- UI package cannot import product state, routing, contracts, Electron, or preload APIs.
- Ordinary UI elevation uses shared tokens; dynamic signal glows are restricted to documented DAW
  domain directories.
