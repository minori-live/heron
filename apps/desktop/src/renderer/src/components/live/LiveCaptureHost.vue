<script setup lang="ts">
import { computed, nextTick, shallowRef, watch } from "vue"
import { useI18n } from "vue-i18n"
import { UiButton, UiCheckbox, UiDialog, UiSelect } from "@heron/ui"
import type {
  LiveCaptureField,
  LiveCaptureStateTarget,
  LiveLayerId,
  LiveRuntimeSnapshot
} from "@heron/contracts"
import { captureFieldKey, liveFieldDefiningLayer } from "@heron/project-model"
import { useLiveStore } from "../../stores/live"

const live = useLiveStore()
const { t } = useI18n()
const selected = shallowRef<string[]>([])
const stateDestinations = shallowRef<Record<string, "owner" | "patch">>({})
let trigger: HTMLElement | null = null
const open = computed({
  get: () => live.captureDialogOpen && live.capturePreview !== null,
  set: (value: boolean) => {
    if (!value && !live.pending) {
      live.capturePreview = null
      live.captureDialogOpen = false
    }
  }
})
watch([open, () => live.capturePreview?.captureId], async ([visible], [wasVisible]) => {
  if (visible) {
    if (!wasVisible)
      trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    selected.value = live.capturePreview!.fields.map(captureFieldKey)
    stateDestinations.value = {}
  } else if (wasVisible) {
    await nextTick()
    if (trigger?.isConnected) trigger.focus()
  }
})
const busy = computed(() => live.pending || live.needsReconciliation || live.quarantined)
const hasWholeState = computed(() =>
  live.capturePreview?.fields.some((field) => field.type === "plugin-state")
)

function layerName(layerId: LiveLayerId): string {
  const hierarchy = live.workspace?.hierarchy
  return hierarchy
    ? ([...hierarchy.sets, ...hierarchy.patches].find((layer) => layer.id === layerId)?.name ??
        t("live.layers.project"))
    : t("live.layers.project")
}

function definingLayer(field: LiveCaptureField): LiveLayerId {
  const preview = live.capturePreview
  const workspace = live.workspace
  return preview && workspace
    ? liveFieldDefiningLayer(workspace.hierarchy, preview.activeLayerId, field)
    : null
}

function stateDestination(field: LiveCaptureField): LiveLayerId {
  return stateDestinations.value[field.id] === "patch"
    ? (live.capturePreview?.activeLayerId ?? null)
    : definingLayer(field)
}

function destinationOptions(field: LiveCaptureField) {
  const owner = definingLayer(field)
  const active = live.capturePreview?.activeLayerId
  return [
    { value: "owner", label: t("live.performance.stateOwnerOption", { name: layerName(owner) }) },
    ...(active != null && active !== owner
      ? [
          {
            value: "patch",
            label: t("live.performance.statePatchOption", { name: layerName(active) })
          }
        ]
      : [])
  ]
}

function destinationScope(field: LiveCaptureField): string {
  const destination = stateDestination(field)
  if (destination === null) return t("live.performance.stateProjectScope")
  const patch = live.workspace?.hierarchy.patches.some((layer) => layer.id === destination)
  return t(patch ? "live.performance.statePatchScope" : "live.performance.stateSetScope", {
    name: layerName(destination)
  })
}

function selectStateDestination(pluginId: string, value: string): void {
  if (value === "owner" || value === "patch")
    stateDestinations.value = { ...stateDestinations.value, [pluginId]: value }
}

function label(field: LiveCaptureField, snapshot: LiveRuntimeSnapshot): string {
  const graph = snapshot.graph
  if (field.type === "channel") {
    const name = graph.channels.find((channel) => channel.id === field.id)?.name ?? field.id
    return `${name} · ${t(`live.layers.fields.${field.parameter}`)}`
  }
  if (field.type === "send") {
    const send = graph.sends.find((candidate) => candidate.id === field.id)
    const source =
      graph.channels.find((channel) => channel.id === send?.sourceChannelId)?.name ?? ""
    const target =
      graph.channels.find((channel) => channel.id === send?.targetChannelId)?.name ??
      `BUS ${send?.targetBus}`
    return `${source} · ${t("live.layers.sendField", { target, field: t(`live.layers.fields.${field.parameter}`) })}`
  }
  const name = graph.plugins.find((plugin) => plugin.id === field.id)?.descriptor.name ?? field.id
  const parameter =
    field.type === "plugin-state"
      ? t("live.performance.pluginState")
      : field.type === "plugin-parameter"
        ? field.parameterKey
        : t("live.layers.fields.enabled")
  return `${name} · ${parameter}`
}

function value(field: LiveCaptureField, snapshot: LiveRuntimeSnapshot, before: boolean): string {
  if (field.type === "plugin-state")
    return t(before ? "live.performance.savedState" : "live.performance.capturedState")
  const raw =
    field.type === "channel"
      ? snapshot.graph.channels.find((channel) => channel.id === field.id)?.[field.parameter]
      : field.type === "send"
        ? snapshot.graph.sends.find((send) => send.id === field.id)?.[field.parameter]
        : field.type === "plugin"
          ? snapshot.graph.plugins.find((plugin) => plugin.id === field.id)?.enabled
          : snapshot.parameterValues.find(
              (parameter) =>
                parameter.pluginId === field.id && parameter.parameterKey === field.parameterKey
            )?.value
  if (raw === undefined) return t("live.performance.notStored")
  if (typeof raw === "boolean") return t(raw ? "live.layers.on" : "live.layers.off")
  if (
    (field.type === "channel" && field.parameter === "gainDb") ||
    (field.type === "send" && field.parameter === "levelDb")
  )
    return raw <= -90 ? "−∞ dB" : `${raw.toFixed(1)} dB`
  return String(Number(raw.toFixed(4)))
}

const groups = computed(() => {
  const preview = live.capturePreview
  const workspace = live.workspace
  if (!preview || !workspace) return []
  const grouped = new Map<
    string,
    {
      key: string
      name: string
      rows: Array<{
        key: string
        field: LiveCaptureField
        label: string
        before: string
        after: string
      }>
    }
  >()
  for (const field of preview.fields) {
    const owner = definingLayer(field)
    const key = owner ?? ""
    if (!grouped.has(key))
      grouped.set(key, {
        key,
        name: layerName(owner),
        rows: []
      })
    grouped.get(key)!.rows.push({
      key: captureFieldKey(field),
      field,
      label: label(field, preview.runtime),
      before: value(field, preview.baseline, true),
      after: value(field, preview.runtime, false)
    })
  }
  return [...grouped.values()]
})

function select(key: string, checked: boolean): void {
  selected.value = checked
    ? [...selected.value, key]
    : selected.value.filter((value) => value !== key)
}
function capture(): void {
  const preview = live.capturePreview
  if (!preview || busy.value) return
  const fields = preview.fields.filter((field) => selected.value.includes(captureFieldKey(field)))
  const targets: LiveCaptureStateTarget[] = fields
    .filter((field) => field.type === "plugin-state")
    .map((field) => ({ pluginId: field.id, layerId: stateDestination(field) }))
  void live.capture(fields, targets.length ? targets : undefined)
}
</script>

<template>
  <UiDialog
    v-model="open"
    :title="t('live.performance.capture')"
    :description="t('live.performance.captureDescription')"
    :dismissible="!live.pending"
    :close-label="t('dialog.actions.cancel')"
    size="lg"
  >
    <div v-if="live.capturePreview" class="grid gap-ui-4">
      <p class="m-0 text-ui-sm text-ui-text-muted">{{ t("live.performance.captureThenRetry") }}</p>
      <p v-if="hasWholeState" class="m-0 text-ui-sm text-ui-text-muted">
        {{ t("live.performance.stateIncludesParameters") }}
      </p>
      <section v-for="group in groups" :key="group.key" class="grid gap-ui-2">
        <h3 class="m-0 text-ui-sm">
          {{ t("live.performance.captureGroupOwner", { name: group.name }) }}
        </h3>
        <div v-for="row in group.rows" :key="row.key" class="grid gap-ui-2">
          <UiCheckbox
            :model-value="selected.includes(row.key)"
            :label="row.label"
            :description="
              t('live.performance.valueChange', { before: row.before, after: row.after })
            "
            :disabled="busy"
            @update:model-value="select(row.key, $event)"
          />
          <div v-if="row.field.type === 'plugin-state'" class="grid gap-ui-2 pl-ui-5">
            <label class="grid gap-ui-1 text-ui-xs">
              {{ t("live.performance.stateDestination") }}
              <UiSelect
                :model-value="stateDestinations[row.field.id] ?? 'owner'"
                :options="destinationOptions(row.field)"
                :aria-label="t('live.performance.stateDestinationFor', { name: row.label })"
                :disabled="busy || !selected.includes(row.key)"
                @update:model-value="selectStateDestination(row.field.id, $event)"
              />
            </label>
            <p class="m-0 text-ui-xs text-ui-text-muted">{{ destinationScope(row.field) }}</p>
          </div>
        </div>
      </section>
      <p v-if="!groups.length" class="m-0 text-ui-sm">{{ t("live.performance.noChanges") }}</p>
      <p v-if="live.error" role="alert" class="m-0 text-ui-sm">{{ live.error }}</p>
      <div class="flex justify-end gap-ui-2">
        <UiButton :disabled="live.pending" @click="open = false">{{
          t("dialog.actions.cancel")
        }}</UiButton>
        <UiButton :disabled="busy || !selected.length" variant="primary" @click="capture">
          {{ t("live.performance.captureSelected", { count: selected.length }) }}
        </UiButton>
      </div>
    </div>
  </UiDialog>
</template>
