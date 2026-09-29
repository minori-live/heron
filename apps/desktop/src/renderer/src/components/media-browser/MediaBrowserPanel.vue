<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from "vue"
import { storeToRefs } from "pinia"
import { FileAudio, FileMusic, Import, Play, Square, X } from "@lucide/vue"
import type { ProjectAssetSummary } from "@heron/contracts"
import {
  UiActionRow,
  UiButton,
  UiDraggableItem,
  UiIconButton,
  UiSegmentedControl,
  UiSearchInput,
  type UiDragData
} from "@heron/ui"
import { useI18n } from "vue-i18n"
import { useProjectStore } from "../../stores/project"
import { useMidiImportStore } from "../../stores/midiImport"
import { useMediaBrowserStore } from "../../stores/mediaBrowser"
import { useStudioWorkspaceStore } from "../../stores/studioWorkspace"
import { PROJECT_MEDIA_DRAG_TYPE } from "../../utils/mediaDrag"

type AssetFilter = "all" | ProjectAssetSummary["kind"]

const { t } = useI18n()
const projectStore = useProjectStore()
const midiImportStore = useMidiImportStore()
const mediaBrowserStore = useMediaBrowserStore()
const workspaceStore = useStudioWorkspaceStore()
const { projectAssets } = storeToRefs(projectStore)
const { selectedAssetId, auditioningAssetId, auditionFailed } = storeToRefs(mediaBrowserStore)
const query = shallowRef("")
const filter = shallowRef<AssetFilter>("all")
const busy = shallowRef(false)
const filterOptions = computed(() =>
  (["all", "audio", "midi"] as const).map((value) => ({
    value,
    label: t(`studio.mediaBrowser.filter.${value}`)
  }))
)

const assets = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  return projectAssets.value.filter(
    (asset) =>
      (filter.value === "all" || asset.kind === filter.value) &&
      (!needle || asset.name.toLocaleLowerCase().includes(needle))
  )
})

watch(projectAssets, (next) => {
  mediaBrowserStore.reconcileAssets(next)
})

function detail(asset: ProjectAssetSummary): string {
  if (asset.kind === "midi") return t("studio.mediaBrowser.midiDetail", { size: asset.byteLength })
  const duration = asset.sampleRate > 0 ? Number(asset.frameCount) / asset.sampleRate : 0
  return t("studio.mediaBrowser.audioDetail", {
    channels: asset.channels,
    rate: Math.round(asset.sampleRate / 100) / 10,
    duration: duration.toFixed(1)
  })
}

async function importAudio(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    const selected = await projectStore.importAudio()
    selectedAssetId.value = selected.at(-1) ?? selectedAssetId.value
  } finally {
    busy.value = false
  }
}

async function importMidi(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    await midiImportStore.prepare()
  } finally {
    busy.value = false
  }
}

function dragData(asset: ProjectAssetSummary): readonly UiDragData[] {
  return [
    {
      mime: PROJECT_MEDIA_DRAG_TYPE,
      value: JSON.stringify({ assetId: asset.id, kind: asset.kind })
    }
  ]
}

onBeforeUnmount(() => {
  void mediaBrowserStore.reset()
})
</script>

<template>
  <aside class="media-browser" data-media-browser :aria-label="t('studio.mediaBrowser.ariaLabel')">
    <header class="browser-header">
      <div>
        <span>{{ t("studio.mediaBrowser.eyebrow") }}</span>
        <h2>{{ t("studio.mediaBrowser.title") }}</h2>
      </div>
      <UiIconButton
        appearance="workspace"
        :label="t('studio.mediaBrowser.close')"
        size="sm"
        @click="workspaceStore.closeRightPanel"
      >
        <X :size="15" />
      </UiIconButton>
    </header>

    <div class="import-row">
      <UiButton size="sm" :disabled="busy" @click="importAudio">
        <Import :size="14" />
        {{ t("studio.mediaBrowser.importAudio") }}
      </UiButton>
      <UiButton size="sm" :disabled="busy" @click="importMidi">
        <FileMusic :size="14" />
        {{ t("studio.mediaBrowser.importMidi") }}
      </UiButton>
    </div>

    <UiSearchInput v-model="query" class="search-field" :label="t('studio.mediaBrowser.search')" />

    <div class="filter-row">
      <UiSegmentedControl
        v-model="filter"
        appearance="separated"
        required
        :label="t('studio.mediaBrowser.filterAria')"
        :options="filterOptions"
        size="compact"
      />
    </div>

    <div class="asset-list" :aria-label="t('studio.mediaBrowser.assets')">
      <UiDraggableItem
        v-for="asset in assets"
        :key="asset.id"
        class="asset-drag"
        :data="dragData(asset)"
        effect-allowed="copy"
      >
        <div class="asset-row">
          <UiActionRow
            density="compact"
            appearance="plain"
            :label="asset.name"
            :description="detail(asset)"
            :selected="selectedAssetId === asset.id"
            @activate="mediaBrowserStore.select(asset.id)"
          >
            <template #leading
              ><span class="kind-mark" :data-kind="asset.kind">
                <FileAudio v-if="asset.kind === 'audio'" :size="14" />
                <FileMusic v-else :size="14" /> </span
            ></template>
          </UiActionRow>
          <UiIconButton
            v-if="asset.kind === 'audio'"
            class="audition-button"
            density="compact"
            size="sm"
            :label="
              auditioningAssetId === asset.id
                ? t('studio.mediaBrowser.stopAudition', { name: asset.name })
                : t('studio.mediaBrowser.startAudition', { name: asset.name })
            "
            @click="mediaBrowserStore.toggleAudition(asset)"
          >
            <Square v-if="auditioningAssetId === asset.id" :size="11" fill="currentColor" />
            <Play v-else :size="12" fill="currentColor" />
          </UiIconButton>
        </div>
      </UiDraggableItem>
      <div v-if="assets.length === 0" class="empty-state">
        <strong>{{ t("studio.mediaBrowser.emptyTitle") }}</strong>
        <span>{{ t("studio.mediaBrowser.emptyDetail") }}</span>
      </div>
    </div>
    <p v-if="auditionFailed" class="browser-error" role="alert">
      {{ t("studio.mediaBrowser.auditionFailed") }}
    </p>
  </aside>
</template>

<style scoped>
.media-browser {
  --ui-color-action: var(--accent);
  --ui-color-surface-hover: var(--surface-hover);
  --ui-color-border-strong: var(--line-strong);
  --ui-color-focus: var(--focus);

  display: flex;
  min-width: 0;
  min-height: 0;
  height: 100%;
  flex-direction: column;
  border-left: 1px solid var(--line-strong);
  background: var(--surface-1);
}
.browser-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 51px;
  padding: 8px 10px 7px 12px;
  border-bottom: 1px solid var(--line-strong);
}
.browser-header span {
  color: var(--text-faint);
  font: var(--ui-type-weight-bold) var(--ui-type-size-caption) var(--ui-type-family-data);
  letter-spacing: var(--ui-type-tracking-wide);
  text-transform: uppercase;
}
.browser-header h2 {
  margin: 1px 0 0;
  font-size: var(--ui-type-size-body-compact);
}
.import-row button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--line-strong);
  color: var(--text-secondary);
  background: var(--daw-control);
}
.import-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  padding: 9px 10px 6px;
}
.import-row button {
  gap: 5px;
  min-height: 29px;
  border-radius: 6px;
  font-size: var(--ui-type-size-caption);
}
.search-field {
  margin: 0 10px 6px;
}
.filter-row {
  display: flex;
  gap: 2px;
  padding: 0 10px 8px;
  border-bottom: 1px solid var(--line-soft);
}
.asset-list {
  min-height: 0;
  padding: 5px 6px 12px;
  flex: 1;
  overflow: auto;
}
.asset-row {
  display: grid;
  width: 100%;
  grid-template-columns: minmax(0, 1fr) 25px;
  align-items: center;
  gap: 4px;
}
.kind-mark {
  display: grid;
  width: 27px;
  height: 27px;
  place-items: center;
  border-radius: 4px;
  color: var(--signal-cyan);
  background: color-mix(in srgb, var(--signal-cyan) 13%, var(--surface-3));
}
.kind-mark[data-kind="midi"] {
  color: var(--signal-green);
  background: color-mix(in srgb, var(--signal-green) 13%, var(--surface-3));
}
.empty-state {
  display: flex;
  align-items: center;
  padding: 36px 20px;
  flex-direction: column;
  gap: 5px;
  color: var(--text-faint);
  text-align: center;
}
.empty-state strong {
  color: var(--text-secondary);
  font-size: var(--ui-type-size-body-compact);
}
.empty-state span {
  font-size: var(--ui-type-size-caption);
  line-height: var(--ui-type-leading-normal);
}
.browser-error {
  margin: 0;
  padding: 7px 10px;
  border-top: 1px solid var(--danger);
  color: var(--danger);
  font-size: var(--ui-type-size-caption);
  background: color-mix(in srgb, var(--danger) 8%, var(--surface-1));
}
button:disabled {
  opacity: 0.55;
}
</style>
