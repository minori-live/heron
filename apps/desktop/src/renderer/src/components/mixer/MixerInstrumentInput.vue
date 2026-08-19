<script setup lang="ts">
import { computed, shallowRef } from "vue"
import { useI18n } from "vue-i18n"
import { Trash2 } from "@lucide/vue"
import { UiButton, UiDropZone, UiIconButton, UiMixerInsert, type UiDragData } from "@heron/ui"
import type { PluginDescriptor, PluginInstanceState, PluginRuntimeStatus } from "@heron/contracts"
import { PLUGIN_DRAG_TYPE, parsePluginDrag } from "../plugins/plugin-drag"
import PluginAudioModeMenu from "../plugins/PluginAudioModeMenu.vue"
import { pluginAudioModeBadge, type PluginSelection } from "../plugins/plugin-audio-mode"
import { pluginDisplayState } from "../plugins/plugin-display-state"
import MixerPluginPicker from "./MixerPluginPicker.vue"

const props = defineProps<{
  instrument: PluginInstanceState | null
  runtime: Record<string, PluginRuntimeStatus>
  plugins: PluginDescriptor[]
}>()

const emit = defineEmits<{
  open: [instanceId: string]
  retry: [instanceId: string]
  remove: [instanceId: string]
  assign: [selection: PluginSelection]
}>()
const pendingDrop = shallowRef<PluginDescriptor | null>(null)
const { t } = useI18n()

const instrumentState = computed<PluginRuntimeStatus["state"]>(() => {
  if (!props.instrument) return "unloaded"
  return pluginDisplayState(props.instrument, props.runtime[props.instrument.id])
})
const failure = computed(() =>
  props.instrument ? props.runtime[props.instrument.id]?.failure : undefined
)
const failureMessage = computed(() =>
  failure.value ? t(`plugins.failure.${failure.value.category}`) : undefined
)

function openOrRetry(): void {
  if (!props.instrument) return
  if (failure.value?.recoverable) emit("retry", props.instrument.id)
  else emit("open", props.instrument.id)
}

function dropInstrument(data: UiDragData[]): void {
  const payload = parsePluginDrag(
    data.find((entry) => entry.mime === PLUGIN_DRAG_TYPE)?.value ?? ""
  )
  if (payload?.source === "catalog" && payload.descriptor.kind === "instrument") {
    pendingDrop.value = payload.descriptor
  }
}

function confirmDrop(selection: PluginSelection): void {
  emit("assign", selection)
  pendingDrop.value = null
}
</script>

<template>
  <div class="instrument-input-wrapper">
    <UiDropZone
      v-if="instrument"
      :label="t('mixer.instrumentInput.assign')"
      :mime-types="[PLUGIN_DRAG_TYPE]"
      @drop="dropInstrument"
    >
      <UiMixerInsert
        :class="['instrument-input', instrumentState]"
        :title="failureMessage"
        :label="
          t('mixer.instrumentInput.ariaLabel', {
            name: instrument.descriptor.name,
            state: instrumentState
          })
        "
      >
        <UiButton
          size="sm"
          variant="plain"
          stop-propagation
          class="instrument-name"
          :title="instrument.descriptor.name"
          :aria-label="
            failure?.recoverable
              ? t('plugins.instrumentSlot.retry')
              : t('mixer.instrumentInput.openEditor', { name: instrument.descriptor.name })
          "
          @click="openOrRetry"
        >
          {{ instrument.descriptor.name }}
        </UiButton>
        <template #actions>
          <span class="instrument-actions">
            <span
              class="mode-badge"
              :title="t('mixer.instrumentInput.audioMode', { mode: instrument.audioMode })"
              >{{ pluginAudioModeBadge(instrument.audioMode) }}</span
            >
            <UiIconButton
              size="sm"
              density="compact"
              variant="danger-ghost"
              stop-propagation
              :label="t('mixer.instrumentInput.remove', { name: instrument.descriptor.name })"
              @click="emit('remove', instrument.id)"
            >
              <Trash2 :size="10" />
            </UiIconButton>
          </span>
        </template>
      </UiMixerInsert>
    </UiDropZone>

    <MixerPluginPicker
      v-else
      :plugins="plugins"
      :title="t('mixer.instrumentInput.chooseTitle')"
      :search-label="t('mixer.instrumentInput.searchInstruments')"
      :empty-message="t('mixer.instrumentInput.noInstruments')"
      @select="emit('assign', $event)"
    >
      <UiDropZone
        :label="t('mixer.instrumentInput.assign')"
        :mime-types="[PLUGIN_DRAG_TYPE]"
        @drop="dropInstrument"
      >
        <UiButton class="instrument-input empty" :aria-label="t('mixer.instrumentInput.assign')" />
      </UiDropZone>
    </MixerPluginPicker>
    <div v-if="pendingDrop" class="drop-mode-menu">
      <PluginAudioModeMenu
        :descriptor="pendingDrop"
        @select="confirmDrop({ descriptor: pendingDrop, audioMode: $event })"
        @cancel="pendingDrop = null"
      />
    </div>
  </div>
</template>

<style scoped>
.instrument-input-wrapper {
  position: relative;
}
.instrument-input {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  width: 100%;
  height: 28px;
  min-width: 0;
  overflow: hidden;
  padding: 0;
  border: 1px solid var(--ui-domain-color-697654);
  border-radius: 4px;
  color: var(--ui-domain-color-fff);
  background: linear-gradient(var(--ui-domain-color-7e9362), var(--ui-domain-color-63764d));
  box-shadow: 0 1px 0 var(--ui-domain-color-ffffff28) inset;
}
.instrument-actions {
  display: grid;
  grid-template-columns: auto 22px;
  align-items: center;
  width: auto;
  height: 100%;
  overflow: hidden;
}
.mode-badge {
  padding: 1px 4px;
  border: 1px solid var(--ui-domain-color-ffffff28);
  border-radius: 3px;
  font: var(--ui-type-size-micro) var(--ui-type-family-data);
}
.drop-mode-menu {
  position: absolute;
  z-index: var(--ui-z-popover);
  top: 32px;
  left: 0;
  width: 232px;
  padding: 9px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  color: var(--text-primary);
  background: var(--surface-1);
  box-shadow: 0 14px 36px var(--ui-domain-color-00000075);
}
.instrument-input.bypassed {
  border-color: var(--ui-domain-color-505050);
  color: var(--ui-domain-color-a7a7a7);
  background: linear-gradient(var(--ui-domain-color-5b5b5b), var(--ui-domain-color-4b4b4b));
  box-shadow: 0 1px 0 var(--ui-domain-color-ffffff12) inset;
}
.instrument-input.loading,
.instrument-input.unloaded {
  border-color: var(--ui-domain-color-566a78);
  color: var(--ui-domain-color-c5d0d7);
  background: linear-gradient(var(--ui-domain-color-617685), var(--ui-domain-color-526573));
}
.instrument-input.failed,
.instrument-input.missing,
.instrument-input.quarantined {
  border-color: var(--ui-domain-color-8d4a43);
  color: var(--ui-domain-color-ffd4ce);
  background: linear-gradient(var(--ui-domain-color-884f49), var(--ui-domain-color-6d3e39));
  box-shadow: 0 1px 0 var(--ui-domain-color-ffffff16) inset;
}
.instrument-input button {
  display: grid;
  place-items: center;
  width: 22px;
  height: 26px;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
}
.instrument-input .instrument-name {
  display: block;
  width: 100%;
  min-width: 0;
  padding: 0 7px;
  overflow: hidden;
  font-size: var(--ui-type-size-control);
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.instrument-input.empty {
  display: grid;
  grid-template-columns: 1fr;
  place-items: center;
  border-color: var(--ui-domain-color-4c4c4c);
  color: var(--ui-domain-color-8f8f8f);
  background: var(--ui-domain-color-4d4d4d);
  box-shadow: 0 1px 2px var(--ui-domain-color-00000038) inset;
  font: inherit;
}
</style>
