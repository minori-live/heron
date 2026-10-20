<script setup lang="ts">
import { useI18n } from "vue-i18n"
import { UiArrangementTrackSurface, UiContextMenu, type UiMenuEntry } from "@heron/ui"
import type { MixerChannelPatch, MixerParameterPreview, TrackFreezeMode } from "@heron/contracts"
import InlineTrackNameEditor from "../InlineTrackNameEditor.vue"
import TrackHeightResizeHandle from "./TrackHeightResizeHandle.vue"
import TrackQuickControls, { type TrackFreezeButtonState } from "./TrackQuickControls.vue"
import type { ArrangementTimelineTrack, ArrangementTrackRow } from "./arrangementWorkspaceTypes"
import { trackHeaderMenu } from "./trackHeaderMenu"

const props = withDefaults(
  defineProps<{
    rows: readonly ArrangementTrackRow[]
    selectedChannelId: string | null
    trackHeight: number
    freezeButtonVisible?: boolean
    freezingTrackIds?: readonly string[]
  }>(),
  {
    freezeButtonVisible: true,
    freezingTrackIds: () => []
  }
)

const emit = defineEmits<{
  select: [channelId: string]
  reorder: [index: number, direction: -1 | 1]
  rename: [channelId: string, name: string]
  preview: [preview: MixerParameterPreview]
  updateChannel: [channelId: string, patch: MixerChannelPatch]
  setScale: [trackId: string, scale: number]
  resetScale: [trackId: string]
  toggleFreeze: [trackId: string]
  setFreezeMode: [trackId: string, mode: TrackFreezeMode]
  setFreezeButtonVisible: [visible: boolean]
}>()

const { t } = useI18n()

function relayChannelUpdate(channelId: string, patch: MixerChannelPatch): void {
  emit("updateChannel", channelId, patch)
}

function freezeState(track: ArrangementTimelineTrack): TrackFreezeButtonState {
  if (props.freezingTrackIds.includes(track.trackId)) return "rendering"
  if (track.freeze?.status === "stale") return "stale"
  if (track.freeze) return "frozen"
  return "off"
}

function headerMenu(row: ArrangementTrackRow): readonly UiMenuEntry[] {
  const track = row.track
  return trackHeaderMenu(
    {
      mode: track.freezeMode ?? "pre-fader",
      frozen: Boolean(track.freeze),
      rendering: props.freezingTrackIds.includes(track.trackId),
      hasContent: row.audioClips.length > 0 || row.midiClips.length > 0,
      systemTrack: track.systemRole !== null,
      buttonVisible: props.freezeButtonVisible
    },
    {
      freeze: t("studio.trackControls.freeze"),
      unfreeze: t("studio.freeze.unfreeze"),
      cancelFreeze: t("studio.trackControls.cancelFreeze"),
      freezeMode: t("studio.trackControls.freezeMode"),
      preFader: t("studio.trackControls.preFader"),
      sourceOnly: t("studio.trackControls.sourceOnly"),
      showFreezeButton: t("studio.trackControls.showFreezeButton"),
      modeLocked: t("studio.trackControls.modeLocked"),
      emptyTrack: t("studio.trackControls.emptyTrack"),
      systemTrack: t("studio.trackControls.systemTrack")
    }
  )
}

function selectHeaderMenu(track: ArrangementTimelineTrack, id: string): void {
  if (id === "freeze" || id === "unfreeze" || id === "cancel-freeze") {
    emit("toggleFreeze", track.trackId)
  } else if (id === "pre-fader" || id === "source-only") {
    emit("setFreezeMode", track.trackId, id)
  } else if (id === "show-freeze-button") {
    emit("setFreezeButtonVisible", !props.freezeButtonVisible)
  }
}
</script>

<template>
  <UiContextMenu
    v-for="(row, index) in rows"
    :key="row.track.id"
    :entries="headerMenu(row)"
    :menu-label="t('studio.trackControls.menuLabel', { name: row.track.name })"
    :empty-message="t('common.noCommands')"
    @select="selectHeaderMenu(row.track, $event)"
  >
    <UiArrangementTrackSurface
      :class="['track-header', { selected: row.track.id === selectedChannelId }]"
      :label="row.track.name"
      :selected="row.track.id === selectedChannelId"
      focusable
      @select="emit('select', row.track.id)"
      @reorder="emit('reorder', index, $event)"
    >
      <span class="track-color" :style="{ background: row.track.color }" /><strong>{{
        String(index + 1).padStart(2, "0")
      }}</strong>
      <div class="track-copy">
        <InlineTrackNameEditor
          class="track-name-editor"
          :name="row.track.name"
          :label="t('studio.arrangement.trackRenameLabel', { name: row.track.name })"
          @rename="emit('rename', row.track.id, $event)"
        />
      </div>
      <TrackQuickControls
        class="track-quick-controls"
        :channel="row.track"
        :freeze-visible="freezeButtonVisible && row.track.systemRole === null"
        :freeze-state="freezeState(row.track)"
        @preview="emit('preview', $event)"
        @update-channel="relayChannelUpdate"
        @toggle-freeze="emit('toggleFreeze', row.track.trackId)"
      />
      <TrackHeightResizeHandle
        :base-height="trackHeight"
        :scale="row.scale"
        :track-name="row.track.name"
        @set-scale="emit('setScale', row.track.trackId, $event)"
        @reset="emit('resetScale', row.track.trackId)"
      />
    </UiArrangementTrackSurface>
  </UiContextMenu>
  <div class="track-spacer" aria-hidden="true" />
</template>

<style scoped>
.track-header {
  position: relative;
  display: grid;
  grid-template-columns: 3px 20px minmax(0, 1fr);
  grid-template-rows: minmax(9px, auto) 23px;
  align-content: center;
  align-items: center;
  column-gap: 6px;
  row-gap: 1px;
  padding: 1px 8px;
  border: 0;
  border-bottom: 1px solid var(--ui-color-border);
  color: var(--ui-color-text);
  background: var(--ui-daw-track-header);
  text-align: left;
}
.track-header.selected {
  background: var(--ui-daw-track-header-selected);
  box-shadow: 3px 0 0 var(--ui-color-action) inset;
}
.track-color {
  grid-row: 1/3;
  align-self: stretch;
  border-radius: var(--ui-radius-xs);
}
.track-header > strong {
  grid-column: 2;
  grid-row: 1;
  color: var(--ui-color-text-subtle);
  font: var(--ui-type-size-control) var(--ui-type-family-data);
  font-variant-numeric: tabular-nums;
}
.track-copy {
  grid-column: 3;
  grid-row: 1;
  min-width: 0;
}
.track-copy b {
  display: block;
  overflow: hidden;
  font-size: var(--ui-type-size-body-compact);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.track-quick-controls {
  grid-column: 2/4;
  grid-row: 2;
}
.track-spacer {
  background: var(--ui-daw-ruler);
}
.track-name-editor {
  display: block;
  font-size: var(--ui-type-size-body-compact);
  font-weight: var(--ui-type-weight-strong);
  letter-spacing: var(--ui-type-tracking-snug);
}
</style>
