<script setup lang="ts">
import { useI18n } from "vue-i18n"
import { SquareArrowOutUpRight, Trash2 } from "@lucide/vue"
import { UiDropZone, UiIconButton, type UiDragData } from "@heron/ui"
import type { PluginDescriptor, PluginFailureCategory } from "@heron/contracts"
import type { PluginInstanceState, PluginRuntimeStatus } from "@heron/contracts"
import { PLUGIN_DRAG_TYPE, parsePluginDrag } from "./plugin-drag"

defineProps<{
  plugin: PluginInstanceState | null
  runtime?: PluginRuntimeStatus
}>()

const emit = defineEmits<{
  open: [instanceId: string]
  remove: [instanceId: string]
  assign: [descriptor: PluginDescriptor]
}>()

const { t } = useI18n()

function failureMessage(category: PluginFailureCategory): string {
  return t(`plugins.failure.${category}`)
}

function drop(data: UiDragData[]): void {
  const payload = parsePluginDrag(
    data.find((entry) => entry.mime === PLUGIN_DRAG_TYPE)?.value ?? ""
  )
  if (payload?.source === "catalog" && payload.descriptor.kind === "instrument") {
    emit("assign", payload.descriptor)
  }
}
</script>

<template>
  <UiDropZone
    class="instrument-slot"
    :label="t('plugins.instrumentSlot.ariaLabel')"
    :mime-types="[PLUGIN_DRAG_TYPE]"
    @drop="drop"
  >
    <div class="slot-heading">
      <span>{{ t("plugins.instrumentSlot.heading") }}</span
      ><b>{{ plugin ? t("plugins.instrumentSlot.vst3") : t("plugins.instrumentSlot.empty") }}</b>
    </div>
    <div v-if="plugin" class="slot-body">
      <i :class="runtime?.state ?? (plugin.enabled ? 'active' : 'bypassed')" />
      <div>
        <strong>{{ plugin.descriptor.name }}</strong
        ><small>{{ plugin.descriptor.vendor }}</small>
      </div>
      <UiIconButton
        size="sm"
        :label="
          runtime?.failure?.recoverable
            ? t('plugins.instrumentSlot.retry')
            : t('plugins.instrumentSlot.openEditor')
        "
        @click="$emit('open', plugin.id)"
      >
        <SquareArrowOutUpRight :size="11" />
      </UiIconButton>
      <UiIconButton
        size="sm"
        variant="danger"
        :label="t('plugins.instrumentSlot.remove')"
        @click="$emit('remove', plugin.id)"
      >
        <Trash2 :size="11" />
      </UiIconButton>
    </div>
    <p v-else>{{ t("plugins.instrumentSlot.chooseHint") }}</p>
    <small v-if="runtime?.failure" class="slot-error" role="status">
      {{ failureMessage(runtime.failure.category) }}
    </small>
    <small v-else-if="runtime?.error" class="slot-error">{{ runtime.error }}</small>
  </UiDropZone>
</template>

<style scoped>
.instrument-slot {
  display: grid;
  gap: 7px;
  padding: 11px 13px;
  border-bottom: 1px solid var(--line-soft);
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--ui-domain-color-73d6a2) 5%, transparent),
    transparent 55%
  );
}
.slot-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--ui-domain-color-73d6a2);
  font: var(--ui-type-weight-bold) var(--ui-type-size-caption) var(--ui-type-family-data);
  letter-spacing: var(--ui-type-tracking-wider);
}
.slot-heading b {
  color: var(--text-faint);
  font-size: var(--ui-type-size-micro);
}
.slot-body {
  display: grid;
  grid-template-columns: 6px minmax(0, 1fr) repeat(2, 24px);
  align-items: center;
  gap: 5px;
  min-height: 34px;
  padding: 5px 5px 5px 7px;
  border: 1px solid var(--line-strong);
  border-radius: 4px;
  background: var(--surface-sunken);
  box-shadow: inset 2px 0 0 color-mix(in srgb, var(--ui-domain-color-73d6a2) 72%, transparent);
}
.slot-body i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--ui-domain-color-73d6a2);
  box-shadow: 0 0 5px color-mix(in srgb, var(--ui-domain-color-73d6a2) 60%, transparent);
}
.slot-body i.bypassed {
  background: var(--text-faint);
  box-shadow: none;
}
.slot-body i.failed,
.slot-body i.missing,
.slot-body i.quarantined {
  background: var(--record);
  box-shadow: 0 0 5px color-mix(in srgb, var(--record) 55%, transparent);
}
.slot-body strong,
.slot-body small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.slot-body strong {
  font-size: var(--ui-type-size-control);
}
.slot-body small {
  margin-top: 2px;
  color: var(--text-faint);
  font-size: var(--ui-type-size-micro);
}
.instrument-slot > p {
  margin: 0;
  color: var(--text-faint);
  font-size: var(--ui-type-size-control);
  line-height: var(--ui-type-leading-normal);
}
.slot-error {
  color: var(--record);
  font-size: var(--ui-type-size-caption);
}
</style>
