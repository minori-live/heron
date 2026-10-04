<script setup lang="ts">
import { computed, nextTick, shallowRef, watch } from "vue"
import { useI18n } from "vue-i18n"
import { FileAudio, Folder, Music2, Settings2 } from "@lucide/vue"
import { UiActionRow, UiButton, UiDialog, UiForm, UiSelect, UiTextInput } from "@heron/ui"
import type { LiveEditCommand, LiveHierarchy, LiveLayerId } from "@heron/contracts"

const props = defineProps<{
  name: string
  pending: boolean
  blocked?: boolean
  hierarchy: LiveHierarchy
  selectedLayerId: LiveLayerId
  error: string
  performing?: boolean
  activeLayerId?: LiveLayerId
}>()
const emit = defineEmits<{
  configure: []
  selectLayer: [layerId: LiveLayerId]
  activateLayer: [layerId: LiveLayerId]
  editLayer: [
    command: LiveEditCommand,
    selection: LiveLayerId,
    settle: (committed: boolean) => void
  ]
}>()
const { t } = useI18n()
const sets = computed(() => [...props.hierarchy.sets].sort((a, b) => a.sortOrder - b.sortOrder))
const selectedSet = computed(() =>
  props.hierarchy.sets.find((set) => set.id === props.selectedLayerId)
)
const selectedPatch = computed(() =>
  props.hierarchy.patches.find((patch) => patch.id === props.selectedLayerId)
)
const selected = computed(() => selectedSet.value ?? selectedPatch.value)
const parentSet = computed(() => selectedSet.value?.id ?? selectedPatch.value?.setId ?? null)
function patches(setId: string) {
  return props.hierarchy.patches
    .filter((patch) => patch.setId === setId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
}
type Action = "createSet" | "createPatch" | "rename" | "copy" | "delete"
const action = shallowRef<Action>("createSet")
const dialogOpen = shallowRef(false)
const actionLayerId = shallowRef<LiveLayerId>(null)
const actionSet = computed(() => props.hierarchy.sets.find((set) => set.id === actionLayerId.value))
const actionPatch = computed(() =>
  props.hierarchy.patches.find((patch) => patch.id === actionLayerId.value)
)
const actionLayer = computed(() => actionSet.value ?? actionPatch.value)
const nameDraft = shallowRef("")
const destination = shallowRef("")
const nameInput = shallowRef<{ focus: () => void } | null>(null)
let trigger: HTMLElement | null = null
function open(actionValue: Action): void {
  action.value = actionValue
  actionLayerId.value = props.selectedLayerId
  nameDraft.value =
    actionValue === "rename"
      ? (selected.value?.name ?? "")
      : actionValue === "copy"
        ? t("live.layers.copyName", { name: selected.value?.name ?? "" })
        : ""
  destination.value = parentSet.value ?? sets.value[0]?.id ?? ""
  trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  dialogOpen.value = true
  void nextTick(() => nameInput.value?.focus())
}
watch(dialogOpen, async (openValue) => {
  if (openValue) return
  await nextTick()
  if (trigger?.isConnected) trigger.focus()
})
const deletedPatches = computed(() => (actionSet.value ? patches(actionSet.value.id) : []))
const deletedOverrideCount = computed(
  () =>
    (actionLayer.value?.overrides.length ?? 0) +
    (actionLayer.value?.pluginStates?.length ?? 0) +
    deletedPatches.value.reduce(
      (count, patch) => count + patch.overrides.length + (patch.pluginStates?.length ?? 0),
      0
    )
)
const needsDestination = computed(
  () => action.value === "createPatch" || (action.value === "copy" && !!actionPatch.value)
)
function submit(): void {
  if (props.pending || props.blocked || (action.value !== "delete" && !nameDraft.value.trim()))
    return
  const name = nameDraft.value.trim()
  let command: LiveEditCommand
  let selection = actionLayerId.value
  if (action.value === "createSet") {
    selection = crypto.randomUUID()
    command = { type: "create-set", setId: selection, name }
  } else if (action.value === "createPatch") {
    if (!destination.value) return
    selection = crypto.randomUUID()
    command = { type: "create-patch", patchId: selection, setId: destination.value, name }
  } else {
    const layer = actionLayer.value
    if (!layer) return
    if (action.value === "rename") command = { type: "rename-live-layer", layerId: layer.id, name }
    else if (action.value === "delete") {
      command = { type: "delete-live-layer", layerId: layer.id }
      selection = actionPatch.value?.setId ?? null
    } else if (actionSet.value) {
      selection = crypto.randomUUID()
      command = {
        type: "copy-live-set",
        sourceId: layer.id,
        setId: selection,
        name,
        patchIds: Object.fromEntries(
          patches(layer.id).map((patch) => [patch.id, crypto.randomUUID()])
        )
      }
    } else {
      if (!destination.value) return
      selection = crypto.randomUUID()
      command = {
        type: "copy-live-patch",
        sourceId: layer.id,
        patchId: selection,
        setId: destination.value,
        name
      }
    }
  }
  emit("editLayer", command, selection, (committed) => {
    if (committed) dialogOpen.value = false
  })
}
</script>

<template>
  <aside
    class="live-project-panel flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-r-solid border-ui-border bg-[var(--ui-color-surface-sunken)]"
    :aria-label="t('live.document')"
  >
    <header
      class="flex min-h-[43px] flex-none items-center border-b border-b-solid border-ui-border px-ui-4 text-ui-xs text-ui-text-muted"
    >
      {{ t("live.document") }}
    </header>
    <nav class="min-h-0 flex-1 overflow-auto p-ui-2" :aria-label="t('live.layers.navigation')">
      <div class="flex items-center gap-ui-1">
        <UiActionRow
          :label="name"
          :title="name"
          :selected="selectedLayerId === null"
          :disabled="pending || blocked"
          density="compact"
          appearance="plain"
          @activate="emit('selectLayer', null)"
        >
          <template #leading><FileAudio :size="14" /></template>
          <template #trailing>{{
            t(
              performing && activeLayerId === null
                ? "live.performance.active"
                : "live.layers.project"
            )
          }}</template>
        </UiActionRow>
        <UiButton
          v-if="performing"
          size="sm"
          :disabled="pending || blocked || activeLayerId === null"
          :aria-label="t('live.performance.activateNamed', { name })"
          @click="emit('activateLayer', null)"
          >{{ t("live.performance.activate") }}</UiButton
        >
      </div>
      <div v-for="set in sets" :key="set.id">
        <UiActionRow
          :label="set.name"
          :title="set.name"
          :selected="selectedLayerId === set.id"
          :disabled="pending || blocked"
          density="compact"
          appearance="plain"
          @activate="emit('selectLayer', set.id)"
        >
          <template #leading><Folder :size="14" /></template>
          <template #trailing>{{ t("live.layers.set") }}</template>
        </UiActionRow>
        <div
          v-for="patch in patches(set.id)"
          :key="patch.id"
          class="flex items-center gap-ui-1 pl-ui-4"
        >
          <UiActionRow
            :label="patch.name"
            :title="patch.name"
            :selected="selectedLayerId === patch.id"
            :disabled="pending || blocked"
            density="compact"
            appearance="plain"
            @activate="emit('selectLayer', patch.id)"
          >
            <template #leading><Music2 :size="14" /></template>
            <template #trailing>{{
              t(
                performing && activeLayerId === patch.id
                  ? "live.performance.active"
                  : "live.layers.patch"
              )
            }}</template>
          </UiActionRow>
          <UiButton
            v-if="performing"
            size="sm"
            :disabled="pending || blocked || activeLayerId === patch.id"
            :aria-label="t('live.performance.activateNamed', { name: patch.name })"
            @click="emit('activateLayer', patch.id)"
            >{{ t("live.performance.activate") }}</UiButton
          >
        </div>
      </div>
    </nav>
    <div
      class="grid max-h-[65%] flex-none gap-ui-2 overflow-auto border-t border-t-solid border-ui-border p-ui-3"
    >
      <div v-if="!performing" class="flex flex-wrap gap-ui-2">
        <UiButton size="sm" :disabled="pending || blocked" @click="open('createSet')">{{
          t("live.layers.createSet")
        }}</UiButton>
        <UiButton
          size="sm"
          :disabled="pending || blocked || sets.length === 0"
          @click="open('createPatch')"
          >{{ t("live.layers.createPatch") }}</UiButton
        >
      </div>
      <div v-if="selected && !performing" class="flex flex-wrap gap-ui-2">
        <UiButton size="sm" :disabled="pending || blocked" @click="open('rename')">{{
          t("live.layers.rename")
        }}</UiButton>
        <UiButton size="sm" :disabled="pending || blocked" @click="open('copy')">{{
          t("live.layers.copy")
        }}</UiButton>
        <UiButton size="sm" :disabled="pending || blocked" @click="open('delete')">{{
          t("live.layers.delete")
        }}</UiButton>
      </div>
      <p v-if="!performing" class="m-0 text-ui-xs text-ui-text-muted">
        {{ t("live.layers.editing", { name: selected?.name ?? t("live.layers.project") }) }}
      </p>
      <p v-else class="m-0 text-ui-xs text-ui-text-muted">
        {{ t("live.performance.navigationDescription") }}
      </p>
      <template v-if="selected && !performing">
        <p class="m-0 text-ui-xs text-ui-text-muted">{{ t("live.layers.projectStructure") }}</p>
        <UiButton size="sm" :disabled="pending || blocked" @click="emit('selectLayer', null)">{{
          t("live.layers.goToProject")
        }}</UiButton>
      </template>
      <slot />
      <UiButton
        variant="ghost"
        size="sm"
        class="w-full justify-start"
        :disabled="pending || blocked || performing"
        @click="emit('configure')"
        ><Settings2 :size="14" />{{ t("live.devices") }}</UiButton
      >
    </div>
    <UiDialog
      v-model="dialogOpen"
      :title="t(`live.layers.${action}`)"
      :dismissible="!pending"
      :close-label="t('dialog.actions.cancel')"
    >
      <UiForm class="grid gap-ui-4" @submit="submit">
        <template v-if="action === 'delete'">
          <p>
            {{
              t("live.layers.deleteImpact", {
                name: selected?.name ?? "",
                patches: deletedPatches.length,
                overrides: deletedOverrideCount
              })
            }}
          </p>
          <ul v-if="deletedPatches.length">
            <li v-for="patch in deletedPatches" :key="patch.id">{{ patch.name }}</li>
          </ul>
          <p>{{ t("live.layers.deleteRecover") }}</p>
        </template>
        <template v-else>
          <label class="grid gap-ui-2"
            >{{ t("live.layers.name")
            }}<UiTextInput
              ref="nameInput"
              v-model="nameDraft"
              :disabled="pending || blocked"
              :maxlength="200"
              required
          /></label>
          <label v-if="needsDestination" class="grid gap-ui-2"
            >{{ t("live.layers.destination")
            }}<UiSelect
              v-model="destination"
              :disabled="pending || blocked"
              :options="sets.map((set) => ({ value: set.id, label: set.name }))"
          /></label>
          <p
            v-if="action === 'copy' && actionPatch && destination !== actionPatch.setId"
            class="m-0 text-ui-sm text-ui-text-muted"
          >
            {{ t("live.layers.crossSetCopy") }}
          </p>
        </template>
        <p v-if="error" role="alert">{{ error }}</p>
        <div class="flex justify-end gap-ui-2">
          <UiButton type="button" :disabled="pending" @click="dialogOpen = false">{{
            t("dialog.actions.cancel")
          }}</UiButton>
          <UiButton
            type="submit"
            :disabled="
              pending ||
              blocked ||
              (action !== 'delete' && !nameDraft.trim()) ||
              (needsDestination && !destination)
            "
            >{{ t(`live.layers.${action}`) }}</UiButton
          >
        </div>
      </UiForm>
    </UiDialog>
  </aside>
</template>
