<script setup lang="ts">
import { useI18n } from "vue-i18n"
import {
  AudioLines,
  BellRing,
  Download,
  Gauge,
  Library,
  List,
  ListMusic,
  NotebookTabs,
  PanelBottom,
  Pencil,
  SlidersHorizontal,
  Zap
} from "@lucide/vue"
import type {
  KeySignatureEventState,
  KeySignatureMode,
  MixerChannelMeter,
  MixerChannelPatch,
  MixerChannelState,
  MixerParameterPreview,
  TempoMapSnapshot,
  TimeSignatureEventState
} from "@heron/contracts"
import WorkspaceControlButton from "../workspace/WorkspaceControlButton.vue"
import StudioMasterControl from "./topbar/StudioMasterControl.vue"
import StudioMusicalDisplay from "./topbar/StudioMusicalDisplay.vue"
import StudioTransportControls from "./topbar/StudioTransportControls.vue"
import WorkspaceTopbar from "../workspace/WorkspaceTopbar.vue"
import WorkspaceControlGroup from "../workspace/WorkspaceControlGroup.vue"

defineProps<{
  engineRunning: boolean
  recording: boolean
  recordingBusy: boolean
  playing: boolean
  playLoading: boolean
  canPlay: boolean
  countInEnabled: boolean
  cycleEnabled: boolean
  externalClock: boolean
  playheadSeconds: number
  tempoMap: TempoMapSnapshot
  keySignatureEvents: KeySignatureEventState[]
  mixerChannels: MixerChannelState[]
  inspectorOpen: boolean
  notesPanelOpen: boolean
  mediaBrowserOpen: boolean
  mixerDockOpen: boolean
  pianoRollDockOpen: boolean
  pianoRollAvailable: boolean
  metronomeChannel: MixerChannelState | null
  masterChannel: MixerChannelState | null
  masterMeter?: MixerChannelMeter
  lowLatencyModeEnabled?: boolean
  lowLatencyModeBusy?: boolean
  lowLatencyModeDisabled?: boolean
  lowLatencyModeTooltip?: string
}>()
const emit = defineEmits<{
  toggleInspector: []
  toggleNotesPanel: []
  toggleMediaBrowser: []
  toggleMixerDock: []
  togglePianoRollDock: []
  toggleRecording: []
  togglePlayback: []
  goToStart: []
  toggleCountIn: []
  toggleCycle: []
  updateTempo: [beatsPerMinute: number]
  updateMeter: [signature: Pick<TimeSignatureEventState, "numerator" | "denominator">]
  updateKey: [signature: { fifths: number; mode: KeySignatureMode }]
  toggleMetronome: []
  previewMaster: [preview: MixerParameterPreview]
  updateMaster: [channelId: string, patch: MixerChannelPatch]
  toggleLowLatencyMode: []
}>()

const { t } = useI18n()
</script>

<template>
  <WorkspaceTopbar>
    <WorkspaceControlGroup class="left-panel-group" data-topbar-group="left-panel">
      <WorkspaceControlButton
        :label="t('studio.topbar.inspector')"
        :pressed="inspectorOpen"
        tutorial-target="studio-inspector"
        tone="accent"
        compact-hidden
        @activate="emit('toggleInspector')"
      >
        <SlidersHorizontal :size="15" />
      </WorkspaceControlButton>
      <WorkspaceControlButton
        :label="t('studio.topbar.downloadManager')"
        unavailable
        compact-hidden
      >
        <Download :size="15" />
      </WorkspaceControlButton>
    </WorkspaceControlGroup>

    <WorkspaceControlGroup
      class="bottom-panel-group"
      data-topbar-group="bottom-panel"
      data-tutorial="studio-lower-editors"
    >
      <WorkspaceControlButton :label="t('studio.topbar.smartControls')" unavailable compact-hidden>
        <Gauge :size="15" />
      </WorkspaceControlButton>
      <WorkspaceControlButton
        :label="t('studio.topbar.mixer')"
        :pressed="mixerDockOpen"
        tone="accent"
        @activate="emit('toggleMixerDock')"
      >
        <PanelBottom :size="15" />
      </WorkspaceControlButton>
      <WorkspaceControlButton
        :label="t('studio.topbar.pianoRoll')"
        :pressed="pianoRollDockOpen"
        :disabled="!pianoRollAvailable"
        tone="accent"
        @activate="emit('togglePianoRollDock')"
      >
        <Pencil :size="15" />
      </WorkspaceControlButton>
    </WorkspaceControlGroup>

    <WorkspaceControlGroup
      class="transport-group"
      data-topbar-group="transport"
      data-tutorial="studio-transport"
    >
      <StudioTransportControls
        :engine-running="engineRunning"
        :recording="recording"
        :recording-busy="recordingBusy"
        :playing="playing"
        :play-loading="playLoading"
        :can-play="canPlay"
        :cycle-enabled="cycleEnabled"
        :external-clock="externalClock"
        @go-to-start="emit('goToStart')"
        @toggle-playback="emit('togglePlayback')"
        @toggle-recording="emit('toggleRecording')"
        @toggle-cycle="emit('toggleCycle')"
      />
    </WorkspaceControlGroup>

    <StudioMusicalDisplay
      data-topbar-group="musical-display"
      data-tutorial="studio-musical-display"
      :playhead-seconds="playheadSeconds"
      :tempo-map="tempoMap"
      :key-signature-events="keySignatureEvents"
      :mixer-channels="mixerChannels"
      @update-tempo="emit('updateTempo', $event)"
      @update-meter="emit('updateMeter', $event)"
      @update-key="emit('updateKey', $event)"
    />

    <WorkspaceControlGroup class="tools-group" data-topbar-group="tools">
      <WorkspaceControlButton
        :label="t('studio.topbar.lowLatencyMode')"
        :tooltip="lowLatencyModeTooltip"
        :pressed="lowLatencyModeEnabled"
        :disabled="lowLatencyModeDisabled || lowLatencyModeBusy"
        tone="success"
        @activate="emit('toggleLowLatencyMode')"
      >
        <Zap :size="15" />
      </WorkspaceControlButton>
      <WorkspaceControlButton :label="t('studio.topbar.varispeed')" unavailable compact-hidden>
        <Gauge :size="15" />
      </WorkspaceControlButton>
      <WorkspaceControlButton :label="t('studio.topbar.tuner')" unavailable compact-hidden>
        <AudioLines :size="15" />
      </WorkspaceControlButton>
      <WorkspaceControlButton :label="t('studio.topbar.solo')" unavailable compact-hidden>
        <span class="letter-control">S</span>
      </WorkspaceControlButton>
    </WorkspaceControlGroup>

    <WorkspaceControlGroup class="metronome-group" data-topbar-group="metronome">
      <WorkspaceControlButton
        :label="t('studio.topbar.countIn')"
        :pressed="countInEnabled"
        compact-hidden
        tone="accent"
        @activate="emit('toggleCountIn')"
      >
        <span class="count-in-control">1234</span>
      </WorkspaceControlButton>
      <WorkspaceControlButton
        :label="t('studio.topbar.metronome')"
        :pressed="metronomeChannel ? !metronomeChannel.muted : false"
        :disabled="metronomeChannel === null"
        tone="accent"
        @activate="emit('toggleMetronome')"
      >
        <BellRing :size="15" />
      </WorkspaceControlButton>
    </WorkspaceControlGroup>

    <StudioMasterControl
      data-topbar-group="master"
      :channel="masterChannel"
      :meter="masterMeter"
      @preview="emit('previewMaster', $event)"
      @update-channel="(channelId, patch) => emit('updateMaster', channelId, patch)"
    />

    <WorkspaceControlGroup
      class="right-panel-group"
      data-topbar-group="right-panel"
      data-tutorial="studio-right-panels"
    >
      <WorkspaceControlButton :label="t('studio.topbar.listEditors')" unavailable compact-hidden>
        <List :size="15" />
      </WorkspaceControlButton>
      <WorkspaceControlButton
        :label="t('studio.topbar.notes')"
        :pressed="notesPanelOpen"
        tone="accent"
        @activate="emit('toggleNotesPanel')"
      >
        <NotebookTabs :size="15" />
      </WorkspaceControlButton>
      <WorkspaceControlButton :label="t('studio.topbar.loopBrowser')" unavailable compact-hidden>
        <ListMusic :size="15" />
      </WorkspaceControlButton>
      <WorkspaceControlButton
        :label="t('studio.topbar.mediaBrowser')"
        :pressed="mediaBrowserOpen"
        tone="accent"
        @activate="emit('toggleMediaBrowser')"
      >
        <Library :size="15" />
      </WorkspaceControlButton>
    </WorkspaceControlGroup>
  </WorkspaceTopbar>
</template>

<style scoped>
.letter-control,
.count-in-control {
  font: var(--ui-type-weight-bold) var(--ui-type-size-body-compact) var(--ui-type-family-data);
}
.count-in-control {
  font-size: var(--ui-type-size-caption);
  letter-spacing: var(--ui-type-tracking-tighter);
}
</style>
