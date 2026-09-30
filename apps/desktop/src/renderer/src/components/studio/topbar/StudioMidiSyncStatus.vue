<script setup lang="ts">
import { useI18n } from "vue-i18n"
import { computed, onMounted } from "vue"
import { storeToRefs } from "pinia"
import { useMidiInputStore } from "../../../stores/midiInput"

const { t } = useI18n()

const midiInputStore = useMidiInputStore()
const { snapshot } = storeToRefs(midiInputStore)
onMounted(() => void midiInputStore.load())

const label = computed(() => {
  const sync = snapshot.value.sync
  const state = t(`midiSettings.sync.${sync.state}`)
  const bpm = sync.effectiveBpm === null ? "" : ` · ${sync.effectiveBpm.toFixed(2)} BPM`
  return `${state}${bpm}`
})
</script>

<template>
  <div
    v-if="snapshot.sync.state !== 'internal'"
    class="midi-sync-status"
    :data-state="snapshot.sync.state"
    :title="snapshot.sync.sourcePortName ?? t('midiSettings.sync.external')"
    aria-live="polite"
  >
    <i />
    <span>{{ label }}</span>
  </div>
</template>

<style scoped>
.midi-sync-status {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 86px;
  padding: 0 7px;
  color: var(--ui-color-text-muted);
  font: var(--ui-type-size-micro) var(--ui-type-family-data);
  white-space: nowrap;
}
.midi-sync-status i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ui-color-action);
}
.midi-sync-status[data-state="waiting"] i,
.midi-sync-status[data-state="locking"] i {
  animation: pulse 1s ease-in-out infinite;
}
.midi-sync-status[data-state="freewheel"] i,
.midi-sync-status[data-state="lost"] i {
  background: var(--ui-signal-mixer-record);
}
@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}
@media (prefers-reduced-motion: reduce) {
  .midi-sync-status i {
    animation: none;
  }
}
</style>
