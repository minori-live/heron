<script setup lang="ts">
import { Activity, Radio } from "@lucide/vue"
import {
  UiButton,
  UiField,
  UiNumberInput,
  UiSegmentedControl,
  UiSelect,
  UiStatusNotice,
  UiTextInput
} from "@heron/ui"
import { APPLICATION_COMMAND_IDS } from "@heron/contracts"
import type {
  ApplicationCommandId,
  MidiControlAddress,
  MidiTransformProfile
} from "@heron/contracts"

const props = defineProps<{
  learning: boolean
  profiles: readonly MidiTransformProfile[]
  monitor: { raw: number; delta: number; rate: number; normalizedDelta: number }
  error: string
  settingsError: string
}>()

const emit = defineEmits<{
  learn: []
  cancel: []
  save: []
}>()

const address = defineModel<MidiControlAddress>("address", { required: true })
const inputMode = defineModel<"absolute" | "relative">("inputMode", { required: true })
const relativeEncoding = defineModel<"one-127" | "twos-complement" | "binary-offset">(
  "relativeEncoding",
  { required: true }
)
const targetType = defineModel<"application-command" | "mixer" | "plugin-parameter">("targetType", {
  required: true
})
const command = defineModel<ApplicationCommandId>("command", { required: true })
const mixerIndex = defineModel<number>("mixerIndex", { required: true })
const mixerParameter = defineModel<"gain" | "pan" | "mute" | "solo">("mixerParameter", {
  required: true
})
const booleanBehavior = defineModel<"toggle" | "absolute">("booleanBehavior", { required: true })
const profileId = defineModel<string>("profileId", { required: true })
const pluginAlias = defineModel<string>("pluginAlias", { required: true })
const parameterKey = defineModel<string>("parameterKey", { required: true })

const messageOptions = [
  { value: "control-change", label: "Control change" },
  { value: "note", label: "Note On" }
]
const inputOptions = [
  { value: "absolute", label: "Absolute" },
  { value: "relative", label: "Relative" }
]
const targetOptions = [
  { value: "application-command", label: "Command" },
  { value: "mixer", label: "Mixer" },
  { value: "plugin-parameter", label: "Plug-in" }
]

function updateAddress(patch: Partial<MidiControlAddress>): void {
  address.value = { ...address.value, ...patch }
}
</script>

<template>
  <div class="mapping-editor">
    <div class="learn-strip" :data-learning="props.learning">
      <span class="learn-indicator"><Radio :size="17" /></span>
      <span class="learn-copy">
        <strong>{{
          props.learning ? "Listening for MIDI…" : address.portName || "Manual address"
        }}</strong>
        <small>
          {{
            props.learning
              ? "Move a knob, fader, button, or key"
              : `Channel ${address.channel + 1} · ${address.type === "note" ? "Note" : "CC"} ${address.number}`
          }}
        </small>
      </span>
      <UiButton v-if="!props.learning" size="sm" variant="secondary" @click="emit('learn')">
        <Activity :size="14" /> Listen again
      </UiButton>
      <span v-else class="listening-label">Live</span>
    </div>

    <div class="monitor-grid" aria-label="MIDI input monitor">
      <span
        ><small>Raw value</small><strong>{{ props.monitor.raw }}</strong></span
      >
      <span
        ><small>Signed delta</small><strong>{{ props.monitor.delta }}</strong></span
      >
      <span
        ><small>Event rate</small><strong>{{ props.monitor.rate.toFixed(1) }} Hz</strong></span
      >
      <span
        ><small>Applied delta</small
        ><strong>{{ props.monitor.normalizedDelta.toFixed(4) }}</strong></span
      >
    </div>

    <fieldset class="editor-group">
      <legend>Hardware message</legend>
      <div class="field-grid">
        <UiField label="Device name">
          <template #default="slotProps">
            <UiTextInput
              :id="slotProps.controlId"
              size="sm"
              :model-value="address.portName"
              @update:model-value="updateAddress({ portName: $event })"
            />
          </template>
        </UiField>
        <UiField label="Device ID" description="Stable identifier used when the device reconnects.">
          <template #default="slotProps">
            <UiTextInput
              :id="slotProps.controlId"
              size="sm"
              :model-value="address.portId"
              @update:model-value="updateAddress({ portId: $event })"
            />
          </template>
        </UiField>
        <UiField label="Channel">
          <template #default="slotProps">
            <UiNumberInput
              :id="slotProps.controlId"
              size="sm"
              :model-value="address.channel + 1"
              :min="1"
              :max="16"
              @update:model-value="updateAddress({ channel: ($event ?? 1) - 1 })"
            />
          </template>
        </UiField>
        <UiField label="Message">
          <template #default="slotProps">
            <UiSelect
              :id="slotProps.controlId"
              size="sm"
              :model-value="address.type"
              :options="messageOptions"
              @update:model-value="updateAddress({ type: $event as MidiControlAddress['type'] })"
            />
          </template>
        </UiField>
        <UiField label="Number">
          <template #default="slotProps">
            <UiNumberInput
              :id="slotProps.controlId"
              size="sm"
              :model-value="address.number"
              :min="0"
              :max="127"
              @update:model-value="updateAddress({ number: $event ?? 0 })"
            />
          </template>
        </UiField>
        <UiField label="Input mode">
          <template #default="slotProps">
            <UiSegmentedControl
              :id="slotProps.controlId"
              v-model="inputMode"
              label="Input mode"
              size="sm"
              :disabled="address.type === 'note'"
              :options="inputOptions"
            />
          </template>
        </UiField>
        <UiField
          v-if="inputMode === 'relative' && address.type === 'control-change'"
          label="Decoder"
        >
          <template #default="slotProps">
            <UiSelect :id="slotProps.controlId" v-model="relativeEncoding" size="sm">
              <option value="one-127">1 / 127</option>
              <option value="twos-complement">Two’s complement</option>
              <option value="binary-offset">Binary offset</option>
            </UiSelect>
          </template>
        </UiField>
      </div>
    </fieldset>

    <fieldset class="editor-group">
      <legend>Target</legend>
      <div class="target-kind">
        <UiSegmentedControl
          v-model="targetType"
          label="Target type"
          size="sm"
          :options="targetOptions"
        />
      </div>
      <div class="field-grid target-fields">
        <UiField v-if="targetType === 'application-command'" label="Application command">
          <template #default="slotProps">
            <UiSelect :id="slotProps.controlId" v-model="command" size="sm">
              <option v-for="id in APPLICATION_COMMAND_IDS" :key="id" :value="id">{{ id }}</option>
            </UiSelect>
          </template>
        </UiField>

        <template v-else-if="targetType === 'mixer'">
          <UiField label="Mixer position" description="Uses the current canonical control order.">
            <template #default="slotProps">
              <UiNumberInput
                :id="slotProps.controlId"
                size="sm"
                :model-value="mixerIndex + 1"
                :min="1"
                @update:model-value="mixerIndex = ($event ?? 1) - 1"
              />
            </template>
          </UiField>
          <UiField label="Parameter">
            <template #default="slotProps">
              <UiSelect :id="slotProps.controlId" v-model="mixerParameter" size="sm">
                <option value="gain">Gain</option>
                <option value="pan">Pan</option>
                <option value="mute">Mute</option>
                <option value="solo">Solo</option>
              </UiSelect>
            </template>
          </UiField>
          <UiField v-if="mixerParameter === 'mute' || mixerParameter === 'solo'" label="Behavior">
            <template #default="slotProps">
              <UiSegmentedControl
                :id="slotProps.controlId"
                v-model="booleanBehavior"
                label="Mute or Solo behavior"
                size="sm"
                :options="[
                  { value: 'toggle', label: 'Toggle' },
                  { value: 'absolute', label: 'Absolute' }
                ]"
              />
            </template>
          </UiField>
        </template>

        <template v-else>
          <UiField label="Control alias" description="The lowercase alias assigned to the plug-in.">
            <template #default="slotProps">
              <UiTextInput
                :id="slotProps.controlId"
                v-model="pluginAlias"
                size="sm"
                placeholder="lead-synth"
              />
            </template>
          </UiField>
          <UiField label="Parameter key">
            <template #default="slotProps">
              <UiTextInput
                :id="slotProps.controlId"
                v-model="parameterKey"
                size="sm"
                placeholder="vst3:1234"
              />
            </template>
          </UiField>
        </template>

        <UiField
          v-if="
            targetType === 'plugin-parameter' ||
            (targetType === 'mixer' && (mixerParameter === 'gain' || mixerParameter === 'pan'))
          "
          label="Transform profile"
        >
          <template #default="slotProps">
            <UiSelect :id="slotProps.controlId" v-model="profileId" size="sm">
              <option value="">Target default</option>
              <option v-for="profile in props.profiles" :key="profile.id" :value="profile.id">
                {{ profile.name }}
              </option>
            </UiSelect>
          </template>
        </UiField>
      </div>
    </fieldset>

    <UiStatusNotice v-if="props.error || props.settingsError" tone="danger" live="assertive">
      {{ props.error || props.settingsError }}
    </UiStatusNotice>

    <div class="editor-actions">
      <UiButton size="sm" variant="secondary" @click="emit('cancel')">Cancel</UiButton>
      <UiButton size="sm" variant="primary" :disabled="Boolean(props.error)" @click="emit('save')">
        Save mapping
      </UiButton>
    </div>
  </div>
</template>

<style scoped>
.mapping-editor {
  display: grid;
  gap: 16px;
  padding: 14px;
  border: 1px solid var(--line-strong);
  border-radius: 7px;
  background: var(--surface-1);
  box-shadow: var(--ui-shadow-highlight-inset);
}

.learn-strip {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--line-soft);
  border-radius: 6px;
  background: var(--surface-sunken);
}

.learn-strip[data-learning="true"] {
  border-color: color-mix(in srgb, var(--accent) 52%, var(--line-strong));
  background: color-mix(in srgb, var(--accent) 7%, var(--surface-sunken));
}

.learn-indicator {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 50%;
  color: var(--text-faint);
  background: var(--surface-2);
}

.learn-strip[data-learning="true"] .learn-indicator {
  color: var(--accent);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 12%, transparent);
}

.learn-copy {
  display: grid;
  gap: 3px;
}

.learn-copy strong {
  font-size: var(--ui-type-size-body-compact);
}

.learn-copy small,
.listening-label {
  color: var(--text-muted);
  font: var(--ui-type-size-caption) var(--ui-type-family-data);
}

.listening-label {
  color: var(--accent);
  font-weight: var(--ui-type-weight-bold);
  letter-spacing: var(--ui-type-tracking-wider);
  text-transform: uppercase;
}

.monitor-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  overflow: hidden;
  border: 1px solid var(--line-soft);
  border-radius: 6px;
  background: var(--line-soft);
  gap: 1px;
}

.monitor-grid span {
  display: grid;
  gap: 4px;
  padding: 9px 10px;
  background: var(--surface-2);
}

.monitor-grid small {
  color: var(--text-faint);
  font-size: var(--ui-type-size-caption);
}

.monitor-grid strong {
  color: var(--text-secondary);
  font: var(--ui-type-size-control) var(--ui-type-family-data);
}

.editor-group {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.editor-group legend {
  width: 100%;
  margin-bottom: 12px;
  padding: 0 0 7px;
  border-bottom: 1px solid var(--line-soft);
  color: var(--text-secondary);
  font: var(--ui-type-weight-semibold) var(--ui-type-size-body-compact)
    var(--ui-type-family-display);
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 12px;
}

.target-kind {
  margin-bottom: 14px;
}

.editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 2px;
}

@media (max-width: 760px) {
  .field-grid,
  .monitor-grid {
    grid-template-columns: 1fr;
  }

  .learn-strip {
    grid-template-columns: 34px minmax(0, 1fr);
  }

  .learn-strip > :last-child {
    grid-column: 1 / -1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .learn-indicator {
    transition: none;
  }
}
</style>
