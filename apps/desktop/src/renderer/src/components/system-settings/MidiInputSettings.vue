<script setup lang="ts">
import { useI18n } from "vue-i18n"
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

const { t } = useI18n()

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
    :page="t('midiSettings.input.page')"
    :title="t('midiSettings.input.title')"
    :description="t('midiSettings.input.description')"
  >
    <SettingsSection
      :eyebrow="t('midiSettings.input.monitor')"
      :title="t('midiSettings.input.clockStatus')"
      :description="t('midiSettings.input.clockStatusDescription')"
    >
      <MidiSyncStatusPanel :sync="props.snapshot.sync" />
    </SettingsSection>

    <SettingsSection
      :eyebrow="t('midiSettings.input.transport')"
      :title="t('midiSettings.input.externalClock')"
      :description="t('midiSettings.input.externalClockDescription')"
    >
      <div class="clock-control">
        <UiCheckbox
          v-model="draft.enabled"
          :label="t('midiSettings.input.followClock')"
          :description="t('midiSettings.input.followClockDescription')"
        />

        <div class="source-row" :data-disabled="!draft.enabled || undefined">
          <span class="source-copy">
            <strong>{{ t("midiSettings.input.clockSource") }}</strong>
            <small>{{ t("midiSettings.input.clockSourceDescription") }}</small>
          </span>
          <UiSelect
            :aria-label="t('midiSettings.input.clockSourceAria')"
            :model-value="draft.sourcePortId ?? ''"
            size="sm"
            :disabled="!draft.enabled"
            @update:model-value="selectClockSource($event)"
          >
            <option value="">{{ t("midiSettings.input.noClockSource") }}</option>
            <option v-for="port in props.snapshot.ports" :key="port.id" :value="port.id">
              {{
                port.connected
                  ? port.name
                  : t("midiSettings.input.missingPort", { name: port.name })
              }}
            </option>
          </UiSelect>
        </div>
      </div>
    </SettingsSection>

    <SettingsSection
      :eyebrow="t('midiSettings.input.timing')"
      :title="t('midiSettings.input.offsets')"
      :description="t('midiSettings.input.offsetsDescription')"
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
      :title="t('midiSettings.input.applyError')"
    >
      {{ props.error || props.snapshot.sync.error }}
    </UiStatusNotice>

    <div class="page-actions">
      <span>{{ dirty ? t("midiSettings.input.unsaved") : t("midiSettings.input.upToDate") }}</span>
      <UiButton
        size="sm"
        variant="primary"
        :loading="props.applying"
        :disabled="!dirty"
        :loading-label="t('midiSettings.input.applying')"
        @click="apply"
      >
        {{ t("midiSettings.input.apply") }}
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
