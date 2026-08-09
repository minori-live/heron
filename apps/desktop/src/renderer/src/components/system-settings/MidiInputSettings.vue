<script setup lang="ts">
import { computed, reactive, watch } from "vue"
import { UiButton, UiCheckbox, UiSelect, UiStatusNotice } from "@heron/ui"
import {
  MAX_MIDI_INPUT_OFFSET_MS,
  type MidiInputSnapshot,
  type MidiSyncPreferences
} from "@heron/contracts"
import SettingsPage from "../settings/SettingsPage.vue"
import SettingsSection from "../settings/SettingsSection.vue"
import MidiInputTimingOffsets from "./MidiInputTimingOffsets.vue"
import MidiSyncStatusPanel from "./MidiSyncStatusPanel.vue"

const props = defineProps<{
  preferences: MidiSyncPreferences
  snapshot: MidiInputSnapshot
  applying: boolean
  error: string
}>()

const emit = defineEmits<{
  apply: [preferences: MidiSyncPreferences]
}>()

function copyPreferences(value: MidiSyncPreferences): MidiSyncPreferences {
  return {
    enabled: value.enabled,
    sourcePortId: value.sourcePortId,
    sourcePortName: value.sourcePortName,
    inputOffsetsMs: { ...value.inputOffsetsMs }
  }
}

const draft = reactive<MidiSyncPreferences>(copyPreferences(props.preferences))

watch(
  () => props.preferences,
  (value) => Object.assign(draft, copyPreferences(value)),
  { deep: true }
)

const dirty = computed(() => JSON.stringify(draft) !== JSON.stringify(props.preferences))

function selectClockSource(portId: string): void {
  const port = props.snapshot.ports.find((candidate) => candidate.id === portId)
  draft.sourcePortId = port?.id ?? null
  draft.sourcePortName = port?.name ?? null
}

function setOffset(portId: string, value: number): void {
  if (!Number.isFinite(value)) return
  draft.inputOffsetsMs[portId] = Math.max(
    -MAX_MIDI_INPUT_OFFSET_MS,
    Math.min(MAX_MIDI_INPUT_OFFSET_MS, value)
  )
}

function apply(): void {
  emit("apply", copyPreferences(draft))
}
</script>

<template>
  <SettingsPage
    category="MIDI"
    page="Input & sync"
    title="MIDI input and external clock"
    description="Connect controllers to Instrument tracks, correct input timing, and optionally follow one external MIDI Clock source."
  >
    <SettingsSection
      eyebrow="Monitor"
      title="Clock status"
      description="Live synchronization health from the selected source. Internal clock remains active when external sync is disabled."
    >
      <MidiSyncStatusPanel :sync="props.snapshot.sync" />
    </SettingsSection>

    <SettingsSection
      eyebrow="Transport"
      title="External clock"
      description="Play and Record wait for Start or Continue. Clock loss freewheels for 500 ms, then pauses."
    >
      <div class="clock-control">
        <UiCheckbox
          v-model="draft.enabled"
          label="Follow external MIDI Clock"
          description="Use timing and transport messages from the selected input."
        />

        <div class="source-row" :data-disabled="!draft.enabled || undefined">
          <span class="source-copy">
            <strong>Clock source</strong>
            <small>Only this port can drive tempo and transport synchronization.</small>
          </span>
          <UiSelect
            aria-label="MIDI clock source"
            :model-value="draft.sourcePortId ?? ''"
            size="sm"
            :disabled="!draft.enabled"
            @update:model-value="selectClockSource($event)"
          >
            <option value="">No clock source</option>
            <option v-for="port in props.snapshot.ports" :key="port.id" :value="port.id">
              {{ port.name }}{{ port.connected ? "" : " — Missing" }}
            </option>
          </UiSelect>
        </div>
      </div>
    </SettingsSection>

    <SettingsSection
      eyebrow="Timing"
      title="Input offsets"
      description="Apply a signed per-port correction before MIDI events are mapped to project frames and ticks."
    >
      <MidiInputTimingOffsets
        :ports="props.snapshot.ports"
        :offsets="draft.inputOffsetsMs"
        @update-offset="setOffset"
      />
    </SettingsSection>

    <UiStatusNotice
      v-if="props.error || props.snapshot.sync.error"
      class="midi-error"
      tone="danger"
      live="assertive"
      title="MIDI settings could not be applied"
    >
      {{ props.error || props.snapshot.sync.error }}
    </UiStatusNotice>

    <div class="page-actions">
      <span>{{ dirty ? "Unsaved MIDI input changes" : "MIDI input settings are up to date" }}</span>
      <UiButton
        size="sm"
        variant="primary"
        :loading="props.applying"
        :disabled="!dirty"
        loading-label="Applying MIDI settings"
        @click="apply"
      >
        Apply MIDI settings
      </UiButton>
    </div>
  </SettingsPage>
</template>

<style scoped>
.clock-control {
  display: grid;
  gap: 16px;
  padding: 12px;
  border: 1px solid var(--line-soft);
  border-radius: 7px;
  background: var(--surface-1);
}

.source-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(180px, 0.8fr);
  align-items: center;
  gap: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--line-soft);
}

.source-row[data-disabled="true"] {
  opacity: 0.58;
}

.source-copy {
  display: grid;
  gap: 4px;
}

.source-copy strong {
  font-size: var(--ui-type-size-body-compact);
}

.source-copy small,
.page-actions span {
  color: var(--text-muted);
  font-size: var(--ui-type-size-caption);
  line-height: var(--ui-type-leading-normal);
}

.midi-error {
  margin-top: 16px;
}

.page-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 14px;
  padding-top: 18px;
}

@media (max-width: 760px) {
  .source-row {
    grid-template-columns: 1fr;
  }

  .page-actions {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
