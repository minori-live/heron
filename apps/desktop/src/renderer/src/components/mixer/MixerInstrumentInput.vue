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

const props = withDefaults(
  defineProps<{
    instrument: PluginInstanceState | null
    runtime: Record<string, PluginRuntimeStatus>
    plugins: PluginDescriptor[]
    editorsEnabled?: boolean
    structureEnabled?: boolean
  }>(),
  { editorsEnabled: true, structureEnabled: true }
)

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
  if (!props.instrument || props.editorsEnabled === false) return
  if (failure.value?.recoverable) emit("retry", props.instrument.id)
  else emit("open", props.instrument.id)
}

function dropInstrument(data: UiDragData[]): void {
  if (!props.structureEnabled) return
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
      :disabled="!structureEnabled"
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
          :disabled="editorsEnabled === false"
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
              :disabled="!structureEnabled"
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
      :inert="!structureEnabled || undefined"
      :plugins="plugins"
      :title="t('mixer.instrumentInput.chooseTitle')"
      :search-label="t('mixer.instrumentInput.searchInstruments')"
      :empty-message="t('mixer.instrumentInput.noInstruments')"
      @select="emit('assign', $event)"
    >
      <UiDropZone
        :disabled="!structureEnabled"
        :label="t('mixer.instrumentInput.assign')"
        :mime-types="[PLUGIN_DRAG_TYPE]"
        @drop="dropInstrument"
      >
        <UiButton
          class="instrument-input empty"
          :disabled="!structureEnabled"
          :aria-label="t('mixer.instrumentInput.assign')"
        />
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
  align-items: center;
  width: 100%;
  height: 28px;
  min-width: 0;
  overflow: hidden;
  padding: 0;
  border: 1px solid var(--ui-domain-face-instrument-border);
  border-radius: 4px;
  color: var(--ui-domain-signal-ink);
  background: linear-gradient(
    var(--ui-domain-face-instrument-top),
    var(--ui-domain-face-instrument-bottom)
  );
  box-shadow: 0 1px 0 var(--ui-domain-face-sheen) inset;
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
  border: 1px solid var(--ui-domain-face-sheen);
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
  border: 1px solid var(--ui-color-border-strong);
  border-radius: 6px;
  color: var(--ui-color-text);
  background: var(--ui-color-surface);
  box-shadow: 0 14px 36px var(--ui-domain-popover-shadow);
}
.instrument-input.bypassed {
  border-color: var(--ui-domain-face-bypassed-border);
  color: var(--ui-domain-face-bypassed-ink);
  background: linear-gradient(
    var(--ui-domain-face-bypassed-top),
    var(--ui-domain-face-bypassed-bottom)
  );
  box-shadow: 0 1px 0 var(--ui-domain-face-bypassed-sheen) inset;
}
.instrument-input.loading,
.instrument-input.unloaded {
  border-color: var(--ui-domain-face-unloaded-border);
  color: var(--ui-domain-face-unloaded-ink);
  background: linear-gradient(
    var(--ui-domain-face-unloaded-top),
    var(--ui-domain-face-unloaded-bottom)
  );
}
.instrument-input.failed,
.instrument-input.missing,
.instrument-input.quarantined {
  border-color: var(--ui-domain-face-failed-border);
  color: var(--ui-domain-face-failed-ink);
  background: linear-gradient(
    var(--ui-domain-face-failed-top),
    var(--ui-domain-face-failed-bottom)
  );
  box-shadow: 0 1px 0 var(--ui-domain-face-failed-sheen) inset;
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
  border-color: var(--ui-domain-face-empty-border);
  color: var(--ui-domain-face-empty-ink);
  background: var(--ui-domain-face-empty-fill);
  box-shadow: 0 1px 2px var(--ui-domain-face-inset) inset;
  font: inherit;
}
</style>
