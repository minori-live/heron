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
import StudioControlButton from "./topbar/StudioControlButton.vue"
import StudioMasterControl from "./topbar/StudioMasterControl.vue"
import StudioMusicalDisplay from "./topbar/StudioMusicalDisplay.vue"
import StudioTransportControls from "./topbar/StudioTransportControls.vue"

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
  <header
    class="topbar col-span-full flex h-[56px] min-w-0 items-center justify-between gap-[clamp(4px,0.55vw,10px)] border-b border-solid px-[12px] py-[5px] [border-bottom-color:var(--line-strong)]"
  >
    <div
      class="control-group left-panel-group flex flex-none items-center gap-[1px] rounded-ui-md p-[2px]"
      data-topbar-group="left-panel"
    >
      <StudioControlButton
        :label="t('studio.topbar.inspector')"
        :pressed="inspectorOpen"
        tutorial-target="studio-inspector"
        tone="accent"
        compact-hidden
        @activate="emit('toggleInspector')"
      >
        <SlidersHorizontal :size="15" />
      </StudioControlButton>
      <StudioControlButton :label="t('studio.topbar.downloadManager')" unavailable compact-hidden>
        <Download :size="15" />
      </StudioControlButton>
    </div>

    <div
      class="control-group bottom-panel-group flex flex-none items-center gap-[1px] rounded-ui-md p-[2px]"
      data-topbar-group="bottom-panel"
      data-tutorial="studio-lower-editors"
    >
      <StudioControlButton :label="t('studio.topbar.smartControls')" unavailable compact-hidden>
        <Gauge :size="15" />
      </StudioControlButton>
      <StudioControlButton
        :label="t('studio.topbar.mixer')"
        :pressed="mixerDockOpen"
        tone="accent"
        @activate="emit('toggleMixerDock')"
      >
        <PanelBottom :size="15" />
      </StudioControlButton>
      <StudioControlButton
        :label="t('studio.topbar.pianoRoll')"
        :pressed="pianoRollDockOpen"
        :disabled="!pianoRollAvailable"
        tone="accent"
        @activate="emit('togglePianoRollDock')"
      >
        <Pencil :size="15" />
      </StudioControlButton>
    </div>

    <div
      class="control-group transport-group flex flex-none items-center gap-[1px] rounded-ui-md p-[2px]"
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
    </div>

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

    <div
      class="control-group tools-group flex flex-none items-center gap-[1px] rounded-ui-md p-[2px]"
      data-topbar-group="tools"
    >
      <StudioControlButton
        :label="t('studio.topbar.lowLatencyMode')"
        :tooltip="lowLatencyModeTooltip"
        :pressed="lowLatencyModeEnabled"
        :disabled="lowLatencyModeDisabled || lowLatencyModeBusy"
        tone="success"
        @activate="emit('toggleLowLatencyMode')"
      >
        <Zap :size="15" />
      </StudioControlButton>
      <StudioControlButton :label="t('studio.topbar.varispeed')" unavailable compact-hidden>
        <Gauge :size="15" />
      </StudioControlButton>
      <StudioControlButton :label="t('studio.topbar.tuner')" unavailable compact-hidden>
        <AudioLines :size="15" />
      </StudioControlButton>
      <StudioControlButton :label="t('studio.topbar.solo')" unavailable compact-hidden>
        <span class="letter-control">S</span>
      </StudioControlButton>
    </div>

    <div
      class="control-group metronome-group flex flex-none items-center gap-[1px] rounded-ui-md p-[2px]"
      data-topbar-group="metronome"
    >
      <StudioControlButton
        :label="t('studio.topbar.countIn')"
        :pressed="countInEnabled"
        compact-hidden
        tone="accent"
        @activate="emit('toggleCountIn')"
      >
        <span class="count-in-control">1234</span>
      </StudioControlButton>
      <StudioControlButton
        :label="t('studio.topbar.metronome')"
        :pressed="metronomeChannel ? !metronomeChannel.muted : false"
        :disabled="metronomeChannel === null"
        tone="accent"
        @activate="emit('toggleMetronome')"
      >
        <BellRing :size="15" />
      </StudioControlButton>
    </div>

    <StudioMasterControl
      data-topbar-group="master"
      :channel="masterChannel"
      :meter="masterMeter"
      @preview="emit('previewMaster', $event)"
      @update-channel="(channelId, patch) => emit('updateMaster', channelId, patch)"
    />

    <div
      class="control-group right-panel-group flex flex-none items-center gap-[1px] rounded-ui-md p-[2px]"
      data-topbar-group="right-panel"
      data-tutorial="studio-right-panels"
    >
      <StudioControlButton :label="t('studio.topbar.listEditors')" unavailable compact-hidden>
        <List :size="15" />
      </StudioControlButton>
      <StudioControlButton
        :label="t('studio.topbar.notes')"
        :pressed="notesPanelOpen"
        tone="accent"
        @activate="emit('toggleNotesPanel')"
      >
        <NotebookTabs :size="15" />
      </StudioControlButton>
      <StudioControlButton :label="t('studio.topbar.loopBrowser')" unavailable compact-hidden>
        <ListMusic :size="15" />
      </StudioControlButton>
      <StudioControlButton
        :label="t('studio.topbar.mediaBrowser')"
        :pressed="mediaBrowserOpen"
        tone="accent"
        @activate="emit('toggleMediaBrowser')"
      >
        <Library :size="15" />
      </StudioControlButton>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  background: color-mix(in srgb, var(--surface-1) 96%, transparent);
  box-shadow:
    0 1px 0 var(--ui-domain-color-ffffff05) inset,
    0 8px 22px var(--shadow);
}
.control-group {
  border: 1px solid color-mix(in srgb, var(--line-strong) 72%, transparent);
  background: color-mix(in srgb, var(--daw-control) 78%, transparent);
  box-shadow: 0 1px 0 var(--ui-domain-color-ffffff05) inset;
}
.letter-control,
.count-in-control {
  font: var(--ui-type-weight-bold) var(--ui-type-size-body-compact) var(--ui-type-family-data);
}
.count-in-control {
  font-size: var(--ui-type-size-caption);
  letter-spacing: var(--ui-type-tracking-tighter);
}
@media (max-width: 1279px) {
  .topbar {
    gap: 5px;
    padding-right: 8px;
    padding-left: 8px;
  }
  .placeholder-only {
    display: none;
  }
  .control-group {
    padding: 1px;
  }
}
</style>
