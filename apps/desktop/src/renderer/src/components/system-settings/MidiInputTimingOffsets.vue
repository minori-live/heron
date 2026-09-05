<script setup lang="ts">
import { useI18n } from "vue-i18n"
import { Cable, Unplug } from "@lucide/vue"
import { UiEmptyState, UiNumberInput } from "@heron/ui"
import type { MidiInputPort } from "@heron/contracts"

const { t } = useI18n()

const props = defineProps<{
  ports: readonly MidiInputPort[]
  offsets: Readonly<Record<string, number | undefined>>
}>()

const emit = defineEmits<{
  updateOffset: [portId: string, value: number]
}>()
</script>

<template>
  <div v-if="props.ports.length" class="port-list">
    <article v-for="port in props.ports" :key="port.id" class="port-row">
      <span class="port-mark" :data-connected="port.connected">
        <Cable v-if="port.connected" :size="15" />
        <Unplug v-else :size="15" />
      </span>
      <span class="port-copy">
        <strong>{{ port.name }}</strong>
        <small>{{
          port.connected ? t("midiSettings.mapping.connected") : t("midiSettings.mapping.missing")
        }}</small>
      </span>
      <span class="offset-control">
        <UiNumberInput
          size="sm"
          :aria-label="t('midiSettings.input.offsetAria', { name: port.name })"
          :model-value="props.offsets[port.id] ?? 0"
          :min="-500"
          :max="500"
          :step="0.1"
          @update:model-value="emit('updateOffset', port.id, $event ?? 0)"
        />
        <em>ms</em>
      </span>
    </article>
  </div>

  <UiEmptyState
    v-else
    :title="t('midiSettings.input.noPorts')"
    :description="t('midiSettings.input.noPortsDescription')"
  >
    <template #icon><Cable :size="20" /></template>
  </UiEmptyState>
</template>

<style scoped>
.port-list {
  display: grid;
  gap: 7px;
}

.port-row {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) minmax(112px, 150px);
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border: 1px solid var(--line-soft);
  border-radius: 6px;
  background: var(--surface-1);
}

.port-mark {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 5px;
  color: var(--text-faint);
  background: var(--surface-sunken);
}

.port-mark[data-connected="true"] {
  color: var(--accent);
}

.port-copy {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.port-copy strong {
  overflow: hidden;
  font-size: var(--ui-type-size-body-compact);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.port-copy small,
.offset-control em {
  color: var(--text-faint);
  font: var(--ui-type-size-caption) var(--ui-type-family-data);
  font-style: normal;
}

.port-copy small {
  color: var(--text-muted);
}

.offset-control {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 20px;
  align-items: center;
  gap: 6px;
}

@media (max-width: 760px) {
  .port-row {
    grid-template-columns: 30px minmax(0, 1fr);
  }

  .offset-control {
    grid-column: 1 / -1;
  }
}
</style>
