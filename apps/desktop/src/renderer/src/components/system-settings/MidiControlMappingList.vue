<script setup lang="ts">
import { Activity, Plus, Trash2 } from "@lucide/vue"
import { UiButton, UiEmptyState, UiStatusNotice } from "@heron/ui"
import type { MidiControlBinding, MidiInputPort } from "@heron/contracts"

const props = defineProps<{
  groups: readonly (readonly [string, readonly MidiControlBinding[]])[]
  ports: readonly MidiInputPort[]
}>()

const emit = defineEmits<{
  add: []
  remove: [id: string]
}>()

function targetLabel(binding: MidiControlBinding): string {
  if (binding.target.type === "application-command") return binding.target.command
  if (binding.target.type === "plugin-parameter") {
    return `${binding.target.controlAlias} · ${binding.target.parameterKey}`
  }
  return `Mixer ${binding.target.channelIndex + 1} · ${binding.target.parameter}`
}

function addressLabel(binding: MidiControlBinding): string {
  const address = binding.address
  const message = address.type === "note" ? `Note ${address.number}` : `CC ${address.number}`
  return `Channel ${address.channel + 1} · ${message}`
}

function connected(binding: MidiControlBinding): boolean {
  return props.ports.some((port) => port.id === binding.address.portId && port.connected)
}
</script>

<template>
  <div class="mapping-control">
    <div class="mapping-toolbar">
      <p>{{ groups.length }} hardware {{ groups.length === 1 ? "address" : "addresses" }}</p>
      <UiButton size="sm" variant="primary" @click="emit('add')">
        <Plus :size="14" /> Learn or add mapping
      </UiButton>
    </div>

    <div v-if="groups.length" class="mapping-list">
      <article v-for="[key, bindings] in groups" :key="key" class="mapping-group">
        <header class="mapping-header">
          <span class="device-mark" :class="{ connected: connected(bindings[0]!) }">
            <Activity :size="15" />
          </span>
          <span class="mapping-address">
            <strong>{{ bindings[0]!.address.portName }}</strong>
            <small>{{ addressLabel(bindings[0]!) }}</small>
          </span>
          <span class="connection-state" :data-connected="connected(bindings[0]!)">
            {{ connected(bindings[0]!) ? "Connected" : "Disconnected" }}
          </span>
        </header>

        <UiStatusNotice
          v-if="bindings.length > 1"
          class="fanout-notice"
          tone="info"
          :title="`${bindings.length} operations share this control`"
        >
          One MIDI message will run every mapping below.
        </UiStatusNotice>

        <ul class="target-list">
          <li v-for="binding in bindings" :key="binding.id" class="target-row">
            <span class="target-copy">
              <strong>{{ targetLabel(binding) }}</strong>
              <small>
                {{ binding.input.type }}
                <template v-if="binding.transformProfileId"> · transformed</template>
              </small>
            </span>
            <UiButton
              size="sm"
              variant="ghost"
              :aria-label="`Remove ${targetLabel(binding)}`"
              @click="emit('remove', binding.id)"
            >
              <Trash2 :size="14" /> Remove
            </UiButton>
          </li>
        </ul>
      </article>
    </div>

    <UiEmptyState
      v-else
      title="No control mappings"
      description="Move a hardware control to learn its address, then choose what it should control."
    >
      <template #icon><Activity :size="20" /></template>
      <template #actions>
        <UiButton size="sm" variant="primary" @click="emit('add')">
          <Plus :size="14" /> Learn first mapping
        </UiButton>
      </template>
    </UiEmptyState>
  </div>
</template>

<style scoped>
.mapping-control,
.mapping-list {
  display: grid;
  gap: 10px;
}

.mapping-toolbar,
.mapping-header,
.target-row {
  display: flex;
  align-items: center;
}

.mapping-toolbar {
  justify-content: space-between;
  gap: 12px;
}

.mapping-toolbar p {
  margin: 0;
  color: var(--text-muted);
  font: var(--ui-type-size-caption) var(--ui-type-family-data);
}

.mapping-group {
  overflow: hidden;
  border: 1px solid var(--line-soft);
  border-radius: 7px;
  background: var(--surface-1);
}

.mapping-header {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) auto;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line-soft);
  background: var(--surface-2);
}

.device-mark {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 1px solid var(--line-strong);
  border-radius: 5px;
  color: var(--text-faint);
  background: var(--surface-sunken);
}

.device-mark.connected {
  border-color: color-mix(in srgb, var(--accent) 42%, var(--line-strong));
  color: var(--accent);
}

.mapping-address,
.target-copy {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.mapping-address strong,
.target-copy strong {
  overflow: hidden;
  font-size: var(--ui-type-size-body-compact);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mapping-address small,
.target-copy small,
.connection-state {
  color: var(--text-faint);
  font: var(--ui-type-size-caption) var(--ui-type-family-data);
}

.connection-state[data-connected="true"] {
  color: var(--accent);
}

.fanout-notice {
  margin: 10px 12px 0;
}

.target-list {
  margin: 0;
  padding: 0 12px;
  list-style: none;
}

.target-row {
  justify-content: space-between;
  gap: 12px;
  min-height: 49px;
  border-top: 1px solid var(--line-soft);
}

.target-row:first-child {
  border-top: 0;
}

@media (max-width: 760px) {
  .mapping-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .connection-state {
    display: none;
  }
}
</style>
