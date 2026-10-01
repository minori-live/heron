<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, shallowRef, watch } from "vue"
import { storeToRefs } from "pinia"
import { useI18n } from "vue-i18n"
import { useRouter } from "vue-router"
import { useWindowSize } from "@vueuse/core"
import { UiButton, UiDialog } from "@heron/ui"
import type {
  AudioDeviceList,
  LiveDocumentConfiguration,
  LiveEditCommand,
  LiveLayerId,
  MixerChannelPatch
} from "@heron/contracts"
import { DEFAULT_METER_RETURN_RATE } from "@heron/contracts"
import type { MixerStripDisplayOptions } from "../components/mixer/mixer-strip-display-options"
import { useLiveStore } from "../stores/live"
import { useLiveWorkspaceStore } from "../stores/liveWorkspace"
import { useAudioRuntimeStore } from "../stores/audioRuntime"
import { useMixerRuntimeStore } from "../stores/mixerRuntime"
import { useLiveMixer } from "../composables/useLiveMixer"
import DocumentWorkspaceShell from "../components/workspace/DocumentWorkspaceShell.vue"
import WorkspaceStatusbar from "../components/workspace/WorkspaceStatusbar.vue"
import MixerSurface from "../components/mixer/MixerSurface.vue"
import LiveTopbar from "../components/live/LiveTopbar.vue"
import LiveProjectPanel from "../components/live/LiveProjectPanel.vue"
import WorkspaceSidePanel from "../components/workspace/WorkspaceSidePanel.vue"
import LiveDeviceSettings from "../components/live/LiveDeviceSettings.vue"
import LiveLayerFields from "../components/live/LiveLayerFields.vue"

const { t } = useI18n()
const router = useRouter()
const live = useLiveStore()
const audio = useAudioRuntimeStore()
const meters = useMixerRuntimeStore()
const mixer = useLiveMixer()
const displayOptions: MixerStripDisplayOptions = {
  meterPeakHold: "800ms",
  meterReturnRate: DEFAULT_METER_RETURN_RATE,
  softwareMonitoringEnabled: true
}
const { graph, master, selectedChannelId, effectPlugins, instrumentPlugins, pluginRuntime } = mixer
const { workspace, pending, error } = storeToRefs(live)
const locked = computed(() => live.needsReconciliation || live.quarantined)
const busy = computed(() => pending.value || locked.value)
const { runtime, statistics, warnings } = storeToRefs(audio)
const { leftPanelOpen, mixerOpen, mixerWidth, selectedLayerId } =
  storeToRefs(useLiveWorkspaceStore())
const selectedLayerName = computed(() => {
  const hierarchy = workspace.value?.hierarchy
  return hierarchy
    ? ([...hierarchy.sets, ...hierarchy.patches].find((layer) => layer.id === selectedLayerId.value)
        ?.name ?? t("live.layers.project"))
    : ""
})
const activeLayerName = computed(
  () =>
    workspace.value?.hierarchy.patches.find(
      (patch) => patch.id === workspace.value?.performance?.activeLayerId
    )?.name ?? t("live.layers.project")
)
watch(
  () => workspace.value?.performance?.generation,
  () => {
    meters.reset()
    if (live.performing) meters.startPolling()
  },
  { immediate: true }
)
onUnmounted(() => meters.reset())
const { width: windowWidth } = useWindowSize()
const maximumMixerWidth = computed(() => Math.max(360, windowWidth.value - 414))
watch(locked, (needed) => {
  if (needed) leftPanelOpen.value = true
})
watch(
  [error, pending],
  ([value, busy]) => {
    if (value && !busy) mixerOpen.value = true
  },
  { immediate: true }
)
const devicesOpen = shallowRef(false)
let deviceTrigger: HTMLElement | null = null
function openDevices(): void {
  if (live.performing || busy.value) return
  deviceTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  devicesOpen.value = true
}
watch(devicesOpen, async (open) => {
  if (open) return
  await nextTick()
  if (deviceTrigger?.isConnected) deviceTrigger.focus()
})
const devices = shallowRef<AudioDeviceList>({ inputs: [], outputs: [] })
const hardwareInputCount = computed(
  () =>
    devices.value.inputs.find(
      (device) => device.id === workspace.value?.session.configuration.audio?.inputDeviceId
    )?.channelCount ?? 0
)
const hardwareOutputCount = computed(
  () =>
    devices.value.outputs.find(
      (device) => device.id === workspace.value?.session.configuration.audio?.outputDeviceId
    )?.channelCount ?? 0
)

watch(
  [() => JSON.stringify(workspace.value?.session.configuration.audio ?? null), devicesOpen],
  async ([, open], _, onCleanup) => {
    let stale = false
    onCleanup(() => {
      stale = true
    })
    devices.value = { inputs: [], outputs: [] }
    const configuration = workspace.value?.session.configuration.audio
    if (!configuration || open) return
    const found = await audio.listDevices(configuration.backend)
    if (!stale && found) devices.value = found
  },
  { immediate: true }
)

onMounted(() => {
  if (!workspace.value) void router.replace({ name: "welcome" })
  else void mixer.loadPlugins()
})

async function configure(configuration: LiveDocumentConfiguration): Promise<void> {
  if (await live.configure(configuration)) devicesOpen.value = false
}
async function closeForRecovery(): Promise<void> {
  if (await live.close()) await router.replace({ name: "welcome" })
}
async function editLayer(
  command: LiveEditCommand,
  selection: LiveLayerId,
  settle: (committed: boolean) => void
): Promise<void> {
  const committed = await live.edit(command)
  if (committed) selectedLayerId.value = selection
  settle(committed)
}
function meterFor(channelId: string) {
  return live.performing ? meters.meterFor(channelId) : undefined
}
function updateMixerChannel(
  channelId: string,
  patch: MixerChannelPatch,
  settle?: () => void
): void {
  void mixer.updateChannel(channelId, patch).then(
    () => settle?.(),
    () => settle?.()
  )
}
</script>

<template>
  <DocumentWorkspaceShell
    v-if="workspace"
    class="live-shell"
    :left-panel-open="leftPanelOpen"
    :right-panel-open="mixerOpen"
  >
    <LiveTopbar
      :name="workspace.session.configuration.name"
      :dirty="workspace.session.dirty"
      :pending="busy"
      :left-panel-open="leftPanelOpen"
      :mixer-open="mixerOpen"
      :master="master"
      :editing-layer="selectedLayerName"
      :performing="live.performing"
      :adjusting="live.adjusting"
      :quarantined="live.quarantined"
      :active-layer="activeLayerName"
      :uncaptured-count="workspace.performance?.uncapturedFields.length ?? 0"
      :master-meter="master ? meterFor(master.id) : undefined"
      @enter-perform="live.perform({ type: 'enter' })"
      @leave-perform="live.leavePerform"
      @capture="live.previewCapture"
      @toggle-left-panel="leftPanelOpen = !leftPanelOpen"
      @toggle-mixer="mixerOpen = !mixerOpen"
      @configure="openDevices"
      @preview="mixer.preview"
      @update-channel="mixer.updateChannel"
    />
    <LiveProjectPanel
      v-if="leftPanelOpen"
      :key="`${workspace.project.epoch}:${workspace.project.id}:${workspace.project.generation}`"
      :name="workspace.session.configuration.name"
      :pending="pending"
      :blocked="locked"
      :hierarchy="workspace.hierarchy"
      :selected-layer-id="selectedLayerId"
      :error="error"
      :performing="live.performing"
      :active-layer-id="workspace.performance?.activeLayerId"
      @activate-layer="live.activate"
      @configure="openDevices"
      @select-layer="selectedLayerId = $event"
      @edit-layer="editLayer"
    >
      <div v-if="locked" class="grid gap-ui-2" role="status">
        <p class="m-0 text-ui-xs text-ui-text-muted">
          {{ t(live.quarantined ? "live.layers.quarantined" : "live.layers.reconciliationNeeded") }}
        </p>
        <UiButton v-if="live.quarantined" size="sm" :disabled="pending" @click="closeForRecovery">{{
          t("live.layers.closeForRecovery")
        }}</UiButton>
        <UiButton v-else size="sm" :disabled="pending" @click="live.reconcile">{{
          t("live.layers.reconcile")
        }}</UiButton>
      </div>
      <LiveLayerFields
        v-if="!live.performing"
        :snapshot="{ graph, parameterValues: mixer.parameterValues.value }"
        :hierarchy="workspace.hierarchy"
        :selected-layer-id="selectedLayerId"
        :selected-channel-id="selectedChannelId"
        :pending="pending"
        :blocked="locked"
        :error="error"
        @edit="live.edit"
      />
    </LiveProjectPanel>
    <section
      class="live-performance-workspace min-h-0 min-w-0 overflow-hidden bg-[var(--ui-daw-workspace)]"
      :aria-label="t('live.performanceWorkspace')"
    />
    <WorkspaceSidePanel
      v-if="mixerOpen"
      v-model="mixerWidth"
      class="live-mixer-panel"
      :label="t('live.mixer')"
      :resize-label="t('live.resizeMixer')"
      :minimum="360"
      :maximum="maximumMixerWidth"
      :default-width="520"
    >
      <MixerSurface
        :inert="locked || undefined"
        :graph="graph"
        :selected-channel-id="selectedChannelId"
        :busy="busy"
        :structure-enabled="!live.performing && selectedLayerId === null"
        :can-undo="live.canUndo"
        :can-redo="live.canRedo"
        :error="error"
        :effect-plugins="effectPlugins"
        :instrument-plugins="instrumentPlugins"
        :plugin-runtime="pluginRuntime"
        :studio-controls="false"
        :application-capture-enabled="false"
        :plugin-editors-enabled="false"
        :meter-source="meterFor"
        :display-options="displayOptions"
        :hardware-input-count="hardwareInputCount"
        :hardware-output-count="hardwareOutputCount"
        @create-channel="mixer.createChannel"
        @undo="live.edit('undo')"
        @redo="live.edit('redo')"
        @select="selectedChannelId = $event"
        @preview="mixer.preview"
        @update-channel="updateMixerChannel"
        @update-send="mixer.updateSend"
        @add-send="mixer.addSend"
        @delete-send="mixer.deleteSend"
        @delete-channel="mixer.deleteChannel"
        @toggle-plugin="mixer.togglePlugin"
        @remove-plugin="mixer.removePlugin"
        @insert-plugin="mixer.insertPlugin"
        @move-plugin="mixer.movePlugin"
        @assign-instrument="mixer.assignInstrument"
        @reset-meter-clips="meters.clearClips"
      />
    </WorkspaceSidePanel>
    <WorkspaceStatusbar :runtime="runtime" :statistics="statistics" :audio-warnings="warnings" />
    <UiDialog
      v-model="devicesOpen"
      :title="t('live.devices')"
      :close-label="t('dialog.actions.cancel')"
      :dismissible="!pending"
    >
      <LiveDeviceSettings
        v-if="devicesOpen"
        :configuration="workspace.session.configuration"
        :pending="busy"
        :error="error"
        @configure="configure"
      />
    </UiDialog>
  </DocumentWorkspaceShell>
</template>
