<script setup lang="ts">
import { useI18n } from "vue-i18n"
import { computed } from "vue"
import { Clock3, Radio, TriangleAlert } from "@lucide/vue"
import type { MidiSyncRuntimeSnapshot } from "@heron/contracts"

const { t } = useI18n()

const props = defineProps<{
  sync: MidiSyncRuntimeSnapshot
}>()

const stateLabel = computed(() => t(`midiSettings.sync.${props.sync.state}`))
const sourceLabel = computed(() => props.sync.sourcePortName ?? t("midiSettings.sync.transport"))
const stateTone = computed(() => {
  if (props.sync.state === "locked") return "healthy"
  if (props.sync.state === "freewheel" || props.sync.state === "lost") return "warning"
  if (props.sync.state === "locking" || props.sync.state === "waiting") return "active"
  return "neutral"
})
</script>

<template>
  <div class="sync-panel" :data-tone="stateTone">
    <div class="sync-identity">
      <span class="sync-mark">
        <TriangleAlert v-if="stateTone === 'warning'" :size="17" />
        <Radio v-else-if="stateTone === 'active' || stateTone === 'healthy'" :size="17" />
        <Clock3 v-else :size="17" />
      </span>
      <span class="sync-copy">
        <small>{{ t("midiSettings.sync.title") }}</small>
        <strong>{{ stateLabel }}</strong>
        <span>{{ sourceLabel }}</span>
      </span>
    </div>

    <div class="sync-metrics">
      <span class="sync-metric">
        <small>{{ t("midiSettings.sync.tempo") }}</small>
        <strong>{{ props.sync.effectiveBpm?.toFixed(2) ?? "—" }}</strong>
        <em>BPM</em>
      </span>
      <span class="sync-metric">
        <small>{{ t("midiSettings.sync.jitter") }}</small>
        <strong>{{ props.sync.jitterMicroseconds?.toFixed(0) ?? "—" }}</strong>
        <em>µs</em>
      </span>
      <span class="sync-metric">
        <small>{{ t("midiSettings.sync.lastClock") }}</small>
        <strong>{{ props.sync.lastClockAgeMs?.toFixed(0) ?? "—" }}</strong>
        <em>ms</em>
      </span>
      <span class="sync-metric">
        <small>{{ t("midiSettings.sync.dropped") }}</small>
        <strong>{{ props.sync.droppedEvents }}</strong>
        <em>{{ t("midiSettings.sync.events") }}</em>
      </span>
    </div>
  </div>
</template>

<style scoped>
.sync-panel {
  display: grid;
  grid-template-columns: minmax(170px, 0.85fr) minmax(300px, 1.4fr);
  overflow: hidden;
  border: 1px solid var(--ui-color-border);
  border-radius: 7px;
  background: var(--ui-color-surface);
}

.sync-panel[data-tone="healthy"] {
  border-color: color-mix(in srgb, var(--ui-color-action) 44%, var(--ui-color-border-strong));
}

.sync-panel[data-tone="warning"] {
  border-color: color-mix(in srgb, var(--ui-color-warning) 48%, var(--ui-color-border-strong));
}

.sync-identity {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 13px;
  border-right: 1px solid var(--ui-color-border);
  background: var(--ui-color-surface-raised);
}

.sync-mark {
  display: grid;
  width: 34px;
  height: 34px;
  flex: none;
  place-items: center;
  border: 1px solid var(--ui-color-border-strong);
  border-radius: 50%;
  color: var(--ui-color-text-faint);
  background: var(--ui-color-surface-sunken);
}

.sync-panel[data-tone="active"] .sync-mark,
.sync-panel[data-tone="healthy"] .sync-mark {
  color: var(--ui-color-action);
}

.sync-panel[data-tone="warning"] .sync-mark {
  color: var(--ui-color-warning);
}

.sync-copy {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.sync-copy small,
.sync-metric small,
.sync-metric em {
  color: var(--ui-color-text-faint);
  font: var(--ui-type-size-caption) var(--ui-type-family-data);
  font-style: normal;
}

.sync-copy small {
  letter-spacing: var(--ui-type-tracking-wider);
  text-transform: uppercase;
}

.sync-copy strong {
  font-size: var(--ui-type-size-body-compact);
}

.sync-copy span {
  overflow: hidden;
  color: var(--ui-color-text-subtle);
  font-size: var(--ui-type-size-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sync-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  background: var(--ui-color-border);
  gap: 1px;
}

.sync-metric {
  display: grid;
  align-content: center;
  gap: 3px;
  min-width: 0;
  padding: 10px;
  background: var(--ui-color-surface);
}

.sync-metric strong {
  color: var(--ui-color-text-muted);
  font: var(--ui-type-weight-semibold) var(--ui-font-size-sm) var(--ui-type-family-data);
}

@media (max-width: 760px) {
  .sync-panel {
    grid-template-columns: 1fr;
  }

  .sync-identity {
    border-right: 0;
    border-bottom: 1px solid var(--ui-color-border);
  }

  .sync-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
