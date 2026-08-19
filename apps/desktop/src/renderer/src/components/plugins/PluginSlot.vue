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
        :label="t('plugins.pluginSlot.openEditor', { name: plugin.descriptor.name })"
        @click="$emit('open', plugin.id)"
      >
        <SquareArrowOutUpRight :size="10" />
      </UiIconButton>
      <UiIconButton
        size="sm"
        variant="danger"
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
  border: 1px solid var(--line-strong);
  border-radius: 3px;
  background: var(--surface-sunken);
}
.badges {
  display: flex;
  gap: 3px;
}
.mode-badge {
  padding: 2px 4px;
  border: 1px solid var(--line-soft);
  border-radius: 3px;
  color: var(--text-muted);
  font: var(--ui-type-size-micro) var(--ui-type-family-data);
}
.ara-badge {
  padding: 2px 4px;
  border: 1px solid color-mix(in srgb, var(--signal-cyan) 52%, var(--line-soft));
  border-radius: 3px;
  color: var(--signal-cyan);
  font: var(--ui-type-weight-bold) var(--ui-type-size-micro) var(--ui-type-family-data);
  letter-spacing: var(--ui-type-tracking-wide);
}
.grip {
  display: grid;
  place-items: center;
  color: var(--text-faint);
}
.plugin-slot i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--signal-cyan);
  box-shadow: 0 0 5px color-mix(in srgb, var(--signal-cyan) 55%, transparent);
}
.plugin-slot i.bypassed {
  background: var(--text-faint);
  box-shadow: none;
}
.plugin-slot i.failed,
.plugin-slot i.missing,
.plugin-slot i.quarantined {
  background: var(--record);
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
}
.plugin-slot small {
  margin-top: 2px;
  color: var(--text-faint);
  font-size: var(--ui-type-size-micro);
}
.failure-message {
  grid-column: 3 / -1;
  color: var(--record);
  white-space: normal;
}
</style>
