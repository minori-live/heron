<script setup lang="ts">
import { computed, onMounted } from "vue"
import { useI18n } from "vue-i18n"
import { storeToRefs } from "pinia"
import { SlidersHorizontal } from "@lucide/vue"
import type { MixerChannelPatch } from "@heron/contracts"
import { useMixerStore } from "../../stores/mixer"
import { useMidiInputStore } from "../../stores/midiInput"
import TrackInspectorFields from "./TrackInspectorFields.vue"

const { t } = useI18n()
const mixerStore = useMixerStore()
const midiInputStore = useMidiInputStore()
const { snapshot: midiInputSnapshot } = storeToRefs(midiInputStore)

onMounted(() => void midiInputStore.load())

const selectedTrack = computed(() => {
  const channel = mixerStore.selectedChannel
  if (!channel || (channel.kind !== "audio" && channel.kind !== "instrument")) return null
  return mixerStore.graph.tracks.some((track) => track.channelId === channel.id) ? channel : null
})

function updateTrack(patch: MixerChannelPatch): void {
  const track = selectedTrack.value
  if (track) void mixerStore.updateChannel(track.id, patch)
}
</script>

<template>
  <aside class="track-inspector" :aria-label="t('studio.trackInspector.ariaLabel')">
    <div class="panel-heading">
      <div>
        <span>{{ t("studio.trackInspector.eyebrow") }}</span>
        <strong>{{ t("studio.trackInspector.title") }}</strong>
      </div>
      <SlidersHorizontal :size="16" aria-hidden="true" />
    </div>

    <TrackInspectorFields
      v-if="selectedTrack"
      :track="selectedTrack"
      :midi-ports="midiInputSnapshot.ports"
      @update="updateTrack"
    />
    <div v-else class="empty-state">
      <SlidersHorizontal :size="20" aria-hidden="true" />
      <strong>{{ t("studio.trackInspector.empty.title") }}</strong>
      <p>{{ t("studio.trackInspector.empty.description") }}</p>
    </div>
  </aside>
</template>

<style scoped>
.track-inspector {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 17px 12px 16px;
  border-right: 1px solid var(--ui-color-border);
  background: var(--ui-color-surface-sunken);
}

.panel-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 0 6px 14px;
}

.panel-heading span,
.panel-heading strong {
  display: block;
}

.panel-heading span {
  color: var(--ui-color-accent);
  font: var(--ui-type-weight-strong) var(--ui-type-size-caption) var(--ui-type-family-interface);
  letter-spacing: var(--ui-type-tracking-eyebrow);
  text-transform: uppercase;
}

.panel-heading strong {
  margin-top: 5px;
  color: var(--ui-color-text);
  font-family: var(--ui-type-family-display);
  font-size: var(--ui-type-size-panel-title);
  font-weight: var(--ui-type-weight-heavy);
  letter-spacing: var(--ui-type-tracking-display);
}

.panel-heading > svg {
  margin-top: 3px;
  color: var(--ui-color-text-subtle);
}

.empty-state {
  display: grid;
  place-items: center;
  margin-top: 4px;
  padding: 28px 12px;
  border: 1px dashed var(--ui-color-glass-edge);
  border-radius: var(--ui-radius-lg);
  color: var(--ui-color-text-faint);
  background: var(--ui-color-fill);
  text-align: center;
}

.empty-state > svg {
  color: var(--ui-color-text-subtle);
}

.empty-state strong {
  margin-top: 10px;
  color: var(--ui-color-text-muted);
  font-size: var(--ui-type-size-body-compact);
  font-weight: var(--ui-type-weight-strong);
}

.empty-state p {
  margin: 6px 0 0;
  color: var(--ui-color-text-faint);
  font-size: var(--ui-type-size-control);
  line-height: var(--ui-type-leading-normal);
}
</style>
