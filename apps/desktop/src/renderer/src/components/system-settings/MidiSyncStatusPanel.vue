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
  border: 1px solid var(--line-soft);
  border-radius: 7px;
  background: var(--surface-1);
}

.sync-panel[data-tone="healthy"] {
  border-color: color-mix(in srgb, var(--accent) 44%, var(--line-strong));
}

.sync-panel[data-tone="warning"] {
  border-color: color-mix(in srgb, var(--warning) 48%, var(--line-strong));
}

.sync-identity {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 13px;
  border-right: 1px solid var(--line-soft);
  background: var(--surface-2);
}

.sync-mark {
  display: grid;
  width: 34px;
  height: 34px;
  flex: none;
  place-items: center;
  border: 1px solid var(--line-strong);
  border-radius: 50%;
  color: var(--text-faint);
  background: var(--surface-sunken);
}

.sync-panel[data-tone="active"] .sync-mark,
.sync-panel[data-tone="healthy"] .sync-mark {
  color: var(--accent);
}

.sync-panel[data-tone="warning"] .sync-mark {
  color: var(--warning);
}

.sync-copy {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.sync-copy small,
.sync-metric small,
.sync-metric em {
  color: var(--text-faint);
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
  color: var(--text-muted);
  font-size: var(--ui-type-size-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sync-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  background: var(--line-soft);
  gap: 1px;
}

.sync-metric {
  display: grid;
  align-content: center;
  gap: 3px;
  min-width: 0;
  padding: 10px;
  background: var(--surface-1);
}

.sync-metric strong {
  color: var(--text-secondary);
  font: var(--ui-type-weight-semibold) var(--ui-font-size-sm) var(--ui-type-family-data);
}

@media (max-width: 760px) {
  .sync-panel {
    grid-template-columns: 1fr;
  }

  .sync-identity {
    border-right: 0;
    border-bottom: 1px solid var(--line-soft);
  }

  .sync-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
