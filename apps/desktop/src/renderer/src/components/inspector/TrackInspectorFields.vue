<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import { AudioWaveform, Piano } from "@lucide/vue"
import { UiColorInput, UiField, UiInlineTextEdit } from "@heron/ui"
import type { MidiInputPort, MixerChannelPatch, MixerChannelState } from "@heron/contracts"
import TrackInspectorMidiInput from "./TrackInspectorMidiInput.vue"

const props = defineProps<{
  track: MixerChannelState
  midiPorts: MidiInputPort[]
}>()

const emit = defineEmits<{
  update: [patch: MixerChannelPatch]
}>()

const { t } = useI18n()
const typeLabel = computed(() => t(`studio.trackInspector.types.${props.track.kind}`))
const typeIcon = computed(() => (props.track.kind === "instrument" ? Piano : AudioWaveform))
const colorModel = computed({
  get: () => props.track.color,
  set: (color: string) => {
    const normalized = color.toUpperCase()
    if (normalized !== props.track.color.toUpperCase()) emit("update", { color: normalized })
  }
})

function commitName(value: string): void {
  const name = value.trim()
  if (name !== props.track.name) emit("update", { name })
}
</script>

<template>
  <div class="track-inspector-fields">
    <header class="track-heading">
      <span class="track-color-rail" :style="{ backgroundColor: track.color }" />
      <span class="track-heading-label">{{ t("studio.trackInspector.selectedTrack") }}</span>
      <strong>{{ track.name }}</strong>
    </header>

    <section class="property-section" :aria-labelledby="`track-identity-${track.id}`">
      <h2 :id="`track-identity-${track.id}`">{{ t("studio.trackInspector.identity.title") }}</h2>
      <UiField :label="t('studio.trackInspector.identity.name')">
        <template #default>
          <UiInlineTextEdit
            :value="track.name"
            :label="t('studio.trackInspector.identity.name')"
            @commit="commitName"
          />
        </template>
      </UiField>
      <UiField :label="t('studio.trackInspector.identity.color')" layout="inline">
        <template #default="{ controlId }">
          <span class="color-control" :title="track.color">
            <span class="color-value">{{ track.color.toUpperCase() }}</span>
            <UiColorInput
              :id="controlId"
              v-model="colorModel"
              :label="t('studio.trackInspector.identity.color')"
            />
          </span>
        </template>
      </UiField>
      <UiField :label="t('studio.trackInspector.identity.type')" layout="inline">
        <span class="track-type"><component :is="typeIcon" :size="13" />{{ typeLabel }}</span>
      </UiField>
    </section>

    <section
      v-if="track.kind === 'instrument'"
      class="property-section"
      :aria-labelledby="`track-midi-${track.id}`"
    >
      <h2 :id="`track-midi-${track.id}`">{{ t("studio.trackInspector.midi.title") }}</h2>
      <TrackInspectorMidiInput
        :route="track.midiInput ?? { portId: null, portName: null, channel: null }"
        :ports="midiPorts"
        @update="emit('update', { midiInput: $event })"
      />
      <p class="section-note">{{ t("studio.trackInspector.midi.description") }}</p>
    </section>
  </div>
</template>

<style scoped>
.track-inspector-fields {
  display: grid;
  gap: 16px;
}

.track-heading {
  display: grid;
  grid-template-columns: 4px minmax(0, 1fr);
  gap: 3px 9px;
  min-width: 0;
  padding: 10px 10px 10px 8px;
  border: 1px solid var(--line-soft);
  border-radius: 7px;
  background: var(--surface-sunken);
}

.track-color-rail {
  grid-row: 1 / 3;
  border-radius: 2px;
}

.track-heading-label {
  color: var(--text-faint);
  font: var(--ui-type-weight-bold) var(--ui-type-size-caption) var(--ui-type-family-data);
  letter-spacing: var(--ui-type-tracking-wider);
  text-transform: uppercase;
}

.track-heading strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-family: var(--ui-type-family-display);
  font-size: var(--ui-type-size-panel-title);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.property-section {
  display: grid;
  gap: 11px;
}

.property-section + .property-section {
  padding-top: 15px;
  border-top: 1px solid var(--line-soft);
}

.property-section h2 {
  margin: 0;
  color: var(--text-faint);
  font: var(--ui-type-weight-bold) var(--ui-type-size-caption) var(--ui-type-family-data);
  letter-spacing: var(--ui-type-tracking-wider);
  text-transform: uppercase;
}

.color-control {
  display: flex;
  align-items: center;
  gap: 7px;
}

.color-value,
.track-type {
  color: var(--text-secondary);
  font: var(--ui-type-size-control) var(--ui-type-family-data);
}

.track-type {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.track-type :deep(svg) {
  color: var(--accent);
}

.section-note {
  margin: -3px 0 0;
  color: var(--text-faint);
  font-size: var(--ui-type-size-caption);
  line-height: var(--ui-type-leading-normal);
}
</style>
