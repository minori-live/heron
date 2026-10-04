<script setup lang="ts">
import { computed, nextTick, shallowRef, watch } from "vue"
import { useI18n } from "vue-i18n"
import { UiButton, UiDialog } from "@heron/ui"
import type {
  LiveEditCommand,
  LiveHierarchy,
  LiveLayerId,
  LiveLayerField,
  LivePerformanceCommand,
  LiveRuntimeSnapshot,
  PluginStateEnvelope
} from "@heron/contracts"
import { liveFieldDefiningLayer } from "@heron/project-model"

const props = defineProps<{
  snapshot: LiveRuntimeSnapshot
  hierarchy: LiveHierarchy
  selectedLayerId: LiveLayerId
  selectedChannelId: string | null
  pending: boolean
  blocked?: boolean
  error: string
}>()
const emit = defineEmits<{ edit: [command: LiveEditCommand] }>()
const { t } = useI18n()
const open = shallowRef(false)
let trigger: HTMLElement | null = null
function show(): void {
  trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  open.value = true
}
watch(open, async (value) => {
  if (value) return
  await nextTick()
  if (trigger?.isConnected) trigger.focus()
})
const channel = computed(() =>
  props.snapshot.graph.channels.find((candidate) => candidate.id === props.selectedChannelId)
)
function layerName(layerId: LiveLayerId): string {
  return (
    [...props.hierarchy.sets, ...props.hierarchy.patches].find((layer) => layer.id === layerId)
      ?.name ?? t("live.layers.project")
  )
}
const selectedName = computed(() => layerName(props.selectedLayerId))
type OverrideValue =
  | LivePerformanceCommand
  | { type: "plugin-state"; id: string; state: PluginStateEnvelope }
const rows = computed(() => {
  const current = channel.value
  if (!current) return []
  const entries: { label: string; command: OverrideValue }[] = []
  for (const parameter of ["gainDb", "pan", "muted", "soloed"] as const) {
    entries.push({
      label: t(`live.layers.fields.${parameter}`),
      command: { type: "channel", id: current.id, parameter, value: current[parameter] }
    })
  }
  for (const send of props.snapshot.graph.sends.filter(
    (candidate) => candidate.sourceChannelId === current.id
  )) {
    const target =
      props.snapshot.graph.channels.find((candidate) => candidate.id === send.targetChannelId)
        ?.name ?? `BUS ${send.targetBus}`
    for (const parameter of ["levelDb", "enabled"] as const) {
      entries.push({
        label: t("live.layers.sendField", { target, field: t(`live.layers.fields.${parameter}`) }),
        command: { type: "send", id: send.id, parameter, value: send[parameter] }
      })
    }
  }
  for (const plugin of props.snapshot.graph.plugins.filter(
    (candidate) => candidate.channelId === current.id
  )) {
    entries.push({
      label: `${plugin.descriptor.name} · ${t("live.layers.fields.enabled")}`,
      command: { type: "plugin", id: plugin.id, parameter: "enabled", value: plugin.enabled }
    })
    entries.push({
      label: `${plugin.descriptor.name} · ${t("live.performance.pluginState")}`,
      command: { type: "plugin-state", id: plugin.id, state: plugin.state }
    })
    for (const parameter of props.snapshot.parameterValues.filter(
      (value) => value.pluginId === plugin.id
    )) {
      entries.push({
        label: `${plugin.descriptor.name} · ${parameter.parameterKey}`,
        command: {
          type: "plugin-parameter",
          id: plugin.id,
          parameterKey: parameter.parameterKey,
          value: parameter.value
        }
      })
    }
  }
  return entries.map(({ label, command }) => {
    let field: LiveLayerField
    if (command.type === "plugin-state") field = { type: "plugin-state", id: command.id }
    else {
      const { value: _value, ...scalarField } = command
      field = scalarField
    }
    const owner = liveFieldDefiningLayer(props.hierarchy, props.selectedLayerId, field)
    const value =
      command.type === "plugin-state"
        ? t(
            command.state.chunks.some((chunk) => chunk.bytes.byteLength > 0)
              ? "live.layers.storedPluginState"
              : "live.layers.defaultPluginState"
          )
        : typeof command.value === "boolean"
          ? t(command.value ? "live.layers.on" : "live.layers.off")
          : command.value
    return {
      label,
      command,
      field,
      owner,
      value,
      key: JSON.stringify(field),
      ownerName: layerName(owner)
    }
  })
})
function createOverride(command: OverrideValue): void {
  if (props.selectedLayerId === null || props.pending || props.blocked) return
  emit(
    "edit",
    command.type === "plugin-state"
      ? {
          type: "set-live-plugin-state",
          layerId: props.selectedLayerId,
          pluginId: command.id,
          state: command.state
        }
      : { type: "set-live-override", layerId: props.selectedLayerId, override: command }
  )
}
</script>

<template>
  <section
    v-if="channel"
    class="min-w-0 border-t border-t-solid border-ui-border pt-ui-3"
    :aria-label="t('live.layers.fieldSources')"
  >
    <p class="m-0 truncate text-ui-xs text-ui-text-muted">
      {{ channel.name }} · {{ t("live.layers.fieldSources") }}
    </p>
    <p class="my-ui-2 text-ui-xs text-ui-text-muted">{{ t("live.layers.editPolicy") }}</p>
    <dl
      class="my-ui-2 grid max-h-[160px] grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-ui-2 overflow-auto text-ui-xs"
    >
      <template v-for="row in rows" :key="row.key"
        ><dt class="truncate" :title="row.label">{{ row.label }}</dt>
        <dd class="m-0 truncate text-right" :title="row.ownerName">
          {{ row.ownerName }}
        </dd></template
      >
    </dl>
    <UiButton size="sm" class="w-full" :disabled="pending || blocked" @click="show">{{
      t("live.layers.manageOverrides")
    }}</UiButton>
    <UiDialog
      v-model="open"
      :title="t('live.layers.manageOverrides')"
      :description="t('live.layers.overrideDescription', { name: selectedName })"
      :dismissible="!pending"
      :close-label="t('dialog.actions.cancel')"
      size="lg"
    >
      <p class="mt-0">{{ channel.name }} · {{ selectedName }}</p>
      <p v-if="selectedLayerId === null" class="text-ui-sm text-ui-text-muted">
        {{ t("live.layers.rootFields") }}
      </p>
      <p
        v-if="rows.some((row) => row.field.type === 'plugin-state')"
        class="text-ui-sm text-ui-text-muted"
      >
        {{ t("live.layers.pluginStatePolicy") }}
      </p>
      <div class="overflow-auto">
        <table class="w-full text-left text-ui-sm">
          <thead>
            <tr>
              <th>{{ t("live.layers.field") }}</th>
              <th>{{ t("live.layers.value") }}</th>
              <th>{{ t("live.layers.definedBy") }}</th>
              <th>{{ t("live.layers.scopeAction") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.key">
              <td class="py-ui-2 pr-ui-3">{{ row.label }}</td>
              <td class="pr-ui-3">
                {{ row.value }}
              </td>
              <td class="pr-ui-3">{{ row.ownerName }}</td>
              <td>
                <UiButton
                  v-if="selectedLayerId !== null && row.owner === selectedLayerId"
                  size="sm"
                  :disabled="pending || blocked"
                  :aria-label="t('live.layers.revertField', { field: row.label })"
                  @click="
                    emit('edit', {
                      type: 'revert-live-override',
                      layerId: selectedLayerId,
                      field: row.field
                    })
                  "
                  >{{ t("live.layers.revert") }}</UiButton
                >
                <UiButton
                  v-else-if="selectedLayerId !== null"
                  size="sm"
                  :disabled="pending || blocked"
                  :aria-label="t('live.layers.overrideField', { field: row.label })"
                  @click="createOverride(row.command)"
                  >{{ t("live.layers.overrideHere") }}</UiButton
                >
                <span v-else>—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="error" role="alert">{{ error }}</p>
    </UiDialog>
  </section>
</template>
