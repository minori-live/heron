<script setup lang="ts">
import type { MixerStripChannel } from "./mixer-surface-context"
import { computed, shallowRef } from "vue"
import { useI18n } from "vue-i18n"
import { GripVertical, Power, RotateCcw, Trash2 } from "@lucide/vue"
import {
  UiButton,
  UiDraggableItem,
  UiDropZone,
  UiIconButton,
  UiMixerInsert,
  type UiDragData
} from "@heron/ui"
import type {
  PluginFailureCategory,
  PluginDescriptor,
  PluginInstanceState,
  PluginRuntimeStatus
} from "@heron/contracts"
import { PLUGIN_DRAG_TYPE, parsePluginDrag, serializePluginDrag } from "../plugins/plugin-drag"
import PluginAudioModeMenu from "../plugins/PluginAudioModeMenu.vue"
import {
  pluginAudioModeBadge,
  pluginAudioModeOutputWidth,
  type PluginSelection,
  type PluginSignalWidth
} from "../plugins/plugin-audio-mode"
import { pluginDisplayState } from "../plugins/plugin-display-state"
import MixerPluginPicker from "./MixerPluginPicker.vue"

const props = withDefaults(
  defineProps<{
    channel: MixerStripChannel
    inserts: PluginInstanceState[]
    runtime: Record<string, PluginRuntimeStatus>
    effectPlugins: PluginDescriptor[]
    slotRows: number
    initialInputWidth: PluginSignalWidth
    editorsEnabled?: boolean
  }>(),
  { editorsEnabled: true }
)

const emit = defineEmits<{
  open: [instanceId: string]
  retry: [instanceId: string]
  toggle: [instanceId: string, enabled: boolean]
  remove: [instanceId: string]
  insert: [selection: PluginSelection, slotOrder: number]
  move: [instanceId: string, slotOrder: number]
}>()

const { t } = useI18n()

const orderedInserts = computed(() =>
  [...props.inserts].sort((left, right) => left.slotOrder - right.slotOrder)
)
const emptyRows = computed(() => Math.max(0, props.slotRows - orderedInserts.value.length))
const alignmentRows = computed(() => Math.max(0, emptyRows.value - 1))
const acceptsPlugins = computed(() => props.channel.kind !== "master")
const pendingDrop = shallowRef<{ descriptor: PluginDescriptor; slotOrder: number } | null>(null)

function inputWidthAt(slotOrder: number): PluginSignalWidth {
  let width = props.initialInputWidth
  const preceding = orderedInserts.value.slice(0, Math.max(0, slotOrder))
  for (const plugin of preceding) width = pluginAudioModeOutputWidth(plugin.audioMode)
  return width
}

function pluginState(plugin: PluginInstanceState): PluginRuntimeStatus["state"] {
  return pluginDisplayState(plugin, props.runtime[plugin.id])
}

function canRetry(plugin: PluginInstanceState): boolean {
  return props.editorsEnabled !== false && props.runtime[plugin.id]?.failure?.recoverable === true
}

function toggleOrRetry(plugin: PluginInstanceState): void {
  if (canRetry(plugin)) emit("retry", plugin.id)
  else emit("toggle", plugin.id, !plugin.enabled)
}

function failureMessage(category: PluginFailureCategory): string {
  return t(`plugins.failure.${category}`)
}

function pluginFailureMessage(plugin: PluginInstanceState): string | undefined {
  const failure = props.runtime[plugin.id]?.failure
  return failure ? failureMessage(failure.category) : undefined
}

function adjustedMoveSlot(instanceId: string, slotOrder: number): number {
  const currentIndex = orderedInserts.value.findIndex((plugin) => plugin.id === instanceId)
  return currentIndex >= 0 && currentIndex < slotOrder ? slotOrder - 1 : slotOrder
}

function pluginDragData(instanceId: string): UiDragData[] {
  return [{ mime: PLUGIN_DRAG_TYPE, value: serializePluginDrag({ source: "rack", instanceId }) }]
}

function dropInsert(data: UiDragData[], slotOrder: number): void {
  const payload = parsePluginDrag(
    data.find((entry) => entry.mime === PLUGIN_DRAG_TYPE)?.value ?? ""
  )
  if (!payload) return
  if (payload.source === "catalog") {
    if (payload.descriptor.kind === "effect") {
      pendingDrop.value = { descriptor: payload.descriptor, slotOrder }
    }
    return
  }
  emit("move", payload.instanceId, adjustedMoveSlot(payload.instanceId, slotOrder))
}

function confirmDrop(selection: PluginSelection): void {
  if (!pendingDrop.value) return
  emit("insert", selection, pendingDrop.value.slotOrder)
  pendingDrop.value = null
}
</script>

<template>
  <section
    class="plugin-section"
    data-section="plugins"
    :aria-label="t('mixer.pluginSection.ariaLabel')"
  >
    <template v-if="acceptsPlugins">
      <template v-for="(plugin, index) in orderedInserts" :key="plugin.id">
        <UiDropZone
          :label="t('mixer.pluginSection.dropAtSlot', { slot: index + 1 })"
          :mime-types="[PLUGIN_DRAG_TYPE]"
          @drop="dropInsert($event, index)"
        >
          <UiDraggableItem
            :data="pluginDragData(plugin.id)"
            effect-allowed="move"
            :label="t('plugins.pluginSlot.move', { name: plugin.descriptor.name })"
          >
            <UiMixerInsert
              :class="['plugin-row', pluginState(plugin)]"
              :title="pluginFailureMessage(plugin)"
              :label="
                t('mixer.pluginSection.pluginState', {
                  name: plugin.descriptor.name,
                  state: pluginState(plugin)
                })
              "
            >
              <UiButton
                size="sm"
                variant="plain"
                stop-propagation
                class="plugin-name"
                :disabled="editorsEnabled === false"
                :title="`${plugin.descriptor.name} · ${plugin.descriptor.vendor}`"
                :aria-label="t('mixer.pluginSection.openEditor', { name: plugin.descriptor.name })"
                @click="emit('open', plugin.id)"
              >
                {{ plugin.descriptor.name }}
              </UiButton>
              <template #leading>
                <span class="plugin-grip" aria-hidden="true">
                  <GripVertical :size="11" aria-hidden="true" />
                </span>
              </template>
              <template #actions>
                <span class="plugin-actions">
                  <span
                    class="mode-badge"
                    :title="t('mixer.pluginSection.audioMode', { mode: plugin.audioMode })"
                    >{{ pluginAudioModeBadge(plugin.audioMode) }}</span
                  >
                  <UiIconButton
                    size="sm"
                    density="compact"
                    variant="plain"
                    stop-propagation
                    :pressed="plugin.enabled"
                    :label="
                      canRetry(plugin)
                        ? t('plugins.pluginSlot.retry', { name: plugin.descriptor.name })
                        : t('mixer.pluginSection.bypassPlugin', {
                            action: plugin.enabled
                              ? t('mixer.pluginSection.bypass')
                              : t('mixer.pluginSection.enable'),
                            name: plugin.descriptor.name
                          })
                    "
                    @click="toggleOrRetry(plugin)"
                  >
                    <RotateCcw v-if="canRetry(plugin)" :size="9" />
                    <Power v-else :size="9" />
                  </UiIconButton>
                  <UiIconButton
                    size="sm"
                    density="compact"
                    variant="danger-ghost"
                    stop-propagation
                    :label="t('mixer.pluginSection.remove', { name: plugin.descriptor.name })"
                    @click="emit('remove', plugin.id)"
                  >
                    <Trash2 :size="9" />
                  </UiIconButton>
                </span>
              </template>
            </UiMixerInsert>
          </UiDraggableItem>
        </UiDropZone>
      </template>

      <MixerPluginPicker
        v-if="emptyRows > 0"
        :plugins="effectPlugins"
        :input-width="inputWidthAt(orderedInserts.length)"
        :title="t('mixer.pluginSection.addEffectTitle')"
        :search-label="t('mixer.pluginSection.searchEffects')"
        :empty-message="t('mixer.pluginSection.noEffects')"
        @select="emit('insert', $event, orderedInserts.length)"
      >
        <UiDropZone
          :label="t('mixer.pluginSection.dropAtSlot', { slot: orderedInserts.length + 1 })"
          :mime-types="[PLUGIN_DRAG_TYPE]"
          @drop="dropInsert($event, orderedInserts.length)"
        >
          <UiButton
            class="plugin-row empty picker-trigger"
            size="sm"
            variant="ghost"
            :aria-label="t('mixer.pluginSection.addEffect')"
          />
        </UiDropZone>
      </MixerPluginPicker>
      <span
        v-for="index in alignmentRows"
        :key="`alignment-${index}`"
        class="plugin-row alignment-spacer"
        aria-hidden="true"
      />
    </template>
    <template v-else>
      <article class="plugin-row empty disabled">
        <span>{{ t("mixer.pluginSection.noInsert") }}</span>
      </article>
      <span
        v-for="index in Math.max(0, slotRows - 1)"
        :key="index"
        class="plugin-row alignment-spacer"
        aria-hidden="true"
      />
    </template>
    <div v-if="pendingDrop" class="drop-mode-menu">
      <PluginAudioModeMenu
        :descriptor="pendingDrop.descriptor"
        :input-width="inputWidthAt(pendingDrop.slotOrder)"
        @select="
          confirmDrop({
            descriptor: pendingDrop.descriptor,
            audioMode: $event
          })
        "
        @cancel="pendingDrop = null"
      />
    </div>
  </section>
</template>

<style scoped>
.plugin-section {
  position: relative;
  display: grid;
  grid-auto-rows: 24px;
  align-content: start;
  min-width: 0;
  padding: 6px 7px;
  border-bottom: 1px solid var(--ui-domain-mixer-divider);
  background: var(--ui-domain-mixer-section);
}
.plugin-row {
  display: grid;
  align-items: center;
  min-width: 0;
  height: 23px;
  overflow: hidden;
  border: 1px solid var(--ui-domain-face-audio-border);
  border-radius: 4px;
  color: var(--ui-domain-signal-ink);
  background: linear-gradient(var(--ui-domain-face-audio-top), var(--ui-domain-face-audio-bottom));
  box-shadow: 0 1px 0 var(--ui-domain-face-sheen) inset;
}
.plugin-grip {
  width: 14px;
  display: grid;
  place-items: center;
  height: 100%;
  overflow: hidden;
  color: currentColor;
  opacity: 0.62;
}
.plugin-actions {
  display: grid;
  grid-template-columns: auto 18px 18px;
  align-items: center;
  width: auto;
  height: 100%;
  overflow: hidden;
}
.mode-badge {
  padding: 1px 3px;
  border: 1px solid var(--ui-domain-face-sheen);
  border-radius: 3px;
  font: var(--ui-type-size-micro) var(--ui-type-family-data);
}
.plugin-drop-preview {
  min-width: 0;
  height: 23px;
  border: 1px solid var(--ui-color-focus);
  border-radius: 4px;
  color: var(--ui-domain-signal-ink);
  background:
    linear-gradient(90deg, transparent, var(--ui-domain-face-audio-bottom), transparent),
    repeating-linear-gradient(
      -45deg,
      var(--ui-domain-face-audio-border),
      var(--ui-domain-face-audio-border) 4px,
      var(--ui-domain-face-audio-top) 4px,
      var(--ui-domain-face-audio-top) 8px
    );
  box-shadow:
    0 0 0 1px var(--ui-domain-face-inset) inset,
    0 0 9px var(--ui-domain-face-audio-glow);
}
.drop-mode-menu {
  position: absolute;
  z-index: var(--ui-z-popover);
  top: 4px;
  left: 4px;
  width: 232px;
  padding: 9px;
  border: 1px solid var(--ui-color-border-strong);
  border-radius: 6px;
  color: var(--ui-color-text);
  background: var(--ui-color-surface);
  box-shadow: 0 14px 36px var(--ui-domain-popover-shadow);
}
.plugin-row.bypassed {
  border-color: var(--ui-domain-face-bypassed-border);
  color: var(--ui-domain-face-bypassed-ink);
  background: linear-gradient(
    var(--ui-domain-face-bypassed-top),
    var(--ui-domain-face-bypassed-bottom)
  );
  box-shadow: 0 1px 0 var(--ui-domain-face-bypassed-sheen) inset;
}
.plugin-row.loading,
.plugin-row.unloaded {
  border-color: var(--ui-domain-face-unloaded-border);
  color: var(--ui-domain-face-unloaded-ink);
  background: linear-gradient(
    var(--ui-domain-face-unloaded-top),
    var(--ui-domain-face-unloaded-bottom)
  );
}
.plugin-row.failed,
.plugin-row.missing,
.plugin-row.quarantined {
  border-color: var(--ui-domain-face-failed-border);
  color: var(--ui-domain-face-failed-ink);
  background: linear-gradient(
    var(--ui-domain-face-failed-top),
    var(--ui-domain-face-failed-bottom)
  );
  box-shadow: 0 1px 0 var(--ui-domain-face-failed-sheen) inset;
}
.plugin-row .plugin-name {
  display: block;
  width: 100%;
  min-width: 0;
  padding: 0 3px;
  overflow: hidden;
  font-size: var(--ui-type-size-control);
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.plugin-row.empty {
  display: grid;
  grid-template-columns: 1fr;
  place-items: center;
  border-color: var(--ui-domain-face-empty-border);
  color: var(--ui-domain-face-empty-ink);
  background: var(--ui-domain-face-empty-fill);
  box-shadow: 0 1px 2px var(--ui-domain-face-inset) inset;
}
.plugin-row.empty span {
  font: var(--ui-type-size-micro) var(--ui-type-family-data);
  letter-spacing: var(--ui-type-tracking-wide);
}
.plugin-row.picker-trigger {
  width: 100%;
  padding: 0;
  font: inherit;
}
.plugin-row.alignment-spacer {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
  pointer-events: none;
}
.plugin-row.disabled {
  opacity: 0.65;
}
</style>
