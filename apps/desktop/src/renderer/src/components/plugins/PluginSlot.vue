<script setup lang="ts">
import { useI18n } from "vue-i18n"
import { computed } from "vue"
import { GripVertical, Power, RotateCcw, SquareArrowOutUpRight, Trash2 } from "@lucide/vue"
import { UiDraggableItem, UiIconButton } from "@heron/ui"
import type {
  PluginFailureCategory,
  PluginInstanceState,
  PluginRuntimeStatus
} from "@heron/contracts"
import { pluginAudioModeBadge } from "./plugin-audio-mode"
import { PLUGIN_DRAG_TYPE, serializePluginDrag } from "./plugin-drag"
import { pluginDisplayState } from "./plugin-display-state"

const props = defineProps<{
  plugin: PluginInstanceState
  runtime?: PluginRuntimeStatus
}>()

const emit = defineEmits<{
  open: [instanceId: string]
  toggle: [instanceId: string, enabled: boolean]
  remove: [instanceId: string]
}>()

const { t } = useI18n()
const canRetry = computed(() => props.runtime?.failure?.recoverable === true)
const dragData = computed(() => [
  {
    mime: PLUGIN_DRAG_TYPE,
    value: serializePluginDrag({ source: "rack", instanceId: props.plugin.id })
  }
])

function toggleOrRetry(): void {
  if (canRetry.value) emit("open", props.plugin.id)
  else emit("toggle", props.plugin.id, !props.plugin.enabled)
}

function failureMessage(category: PluginFailureCategory): string {
  return t(`plugins.failure.${category}`)
}
</script>

<template>
  <UiDraggableItem :data="dragData" effect-allowed="move">
    <article class="plugin-slot" :data-plugin-id="plugin.id">
      <span
        class="grip"
        :aria-label="t('plugins.pluginSlot.move', { name: plugin.descriptor.name })"
      >
        <GripVertical :size="11" aria-hidden="true" />
      </span>
      <i :class="pluginDisplayState(plugin, runtime)" />
      <div>
        <strong>{{ plugin.descriptor.name }}</strong
        ><small>{{ plugin.descriptor.vendor }}</small>
      </div>
      <span class="badges">
        <span
          class="mode-badge"
          :title="t('plugins.pluginSlot.audioMode', { mode: plugin.audioMode })"
          >{{ pluginAudioModeBadge(plugin.audioMode) }}</span
        >
        <span
          v-if="plugin.descriptor.ara"
          class="ara-badge"
          :title="t('plugins.pluginSlot.araTitle')"
          >ARA</span
        >
      </span>
      <UiIconButton
        size="sm"
        density="compact"
        :pressed="plugin.enabled"
        :label="
          canRetry
            ? t('plugins.pluginSlot.retry', { name: plugin.descriptor.name })
            : t('plugins.pluginSlot.toggle', {
                action: plugin.enabled
                  ? t('plugins.pluginSlot.bypass')
                  : t('plugins.pluginSlot.enable'),
                name: plugin.descriptor.name
              })
        "
        @click="toggleOrRetry"
      >
        <RotateCcw v-if="canRetry" :size="10" />
        <Power v-else :size="10" />
      </UiIconButton>
      <UiIconButton
        size="sm"
        density="compact"
        :label="t('plugins.pluginSlot.openEditor', { name: plugin.descriptor.name })"
        @click="$emit('open', plugin.id)"
      >
        <SquareArrowOutUpRight :size="10" />
      </UiIconButton>
      <UiIconButton
        size="sm"
        density="compact"
        variant="danger-ghost"
        :label="t('plugins.pluginSlot.remove', { name: plugin.descriptor.name })"
        @click="$emit('remove', plugin.id)"
      >
        <Trash2 :size="10" />
      </UiIconButton>
      <small v-if="runtime?.failure" class="failure-message" role="status">
        {{ failureMessage(runtime.failure.category) }}
      </small>
    </article>
  </UiDraggableItem>
</template>

<style scoped>
.plugin-slot {
  display: grid;
  grid-template-columns: 12px 5px minmax(0, 1fr) auto repeat(3, 22px);
  align-items: center;
  gap: 5px;
  min-height: 31px;
  padding: 4px;
  border: 1px solid var(--ui-color-glass-edge);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-color-fill);
}
.badges {
  display: flex;
  gap: 3px;
}
.mode-badge {
  padding: 2px 4px;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-xs);
  color: var(--ui-color-text-subtle);
  background: var(--ui-color-fill);
  font: var(--ui-type-size-micro) var(--ui-type-family-data);
}
.ara-badge {
  padding: 2px 4px;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-xs);
  color: var(--ui-signal-audio);
  background: color-mix(in srgb, var(--ui-signal-audio) 16%, transparent);
  font: var(--ui-type-weight-strong) var(--ui-type-size-micro) var(--ui-type-family-interface);
  letter-spacing: var(--ui-type-tracking-eyebrow);
}
.grip {
  display: grid;
  place-items: center;
  color: var(--ui-color-text-faint);
}
.plugin-slot i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--ui-signal-audio);
}
.plugin-slot i.bypassed {
  background: var(--ui-color-text-faint);
}
.plugin-slot i.failed,
.plugin-slot i.missing,
.plugin-slot i.quarantined {
  background: var(--ui-signal-record);
}
.plugin-slot strong,
.plugin-slot small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.plugin-slot strong {
  font-size: var(--ui-type-size-control);
  font-weight: var(--ui-type-weight-strong);
}
.plugin-slot small {
  margin-top: 2px;
  color: var(--ui-color-text-faint);
  font-size: var(--ui-type-size-micro);
}
.failure-message {
  grid-column: 3 / -1;
  color: var(--ui-signal-record);
  white-space: normal;
}
</style>
