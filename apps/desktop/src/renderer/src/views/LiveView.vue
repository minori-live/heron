<script setup lang="ts">
import { computed, nextTick, onMounted, shallowRef, watch } from "vue"
import { storeToRefs } from "pinia"
import { useI18n } from "vue-i18n"
import { useRouter } from "vue-router"
import { useWindowSize } from "@vueuse/core"
import { UiDialog } from "@heron/ui"
import type {
  AudioDeviceList,
  LiveDocumentConfiguration,
  MixerChannelPatch
} from "@heron/contracts"
import { DEFAULT_METER_RETURN_RATE } from "@heron/contracts"
import type { MixerStripDisplayOptions } from "../components/mixer/mixer-strip-display-options"
import { useLiveStore } from "../stores/live"
import { useLiveWorkspaceStore } from "../stores/liveWorkspace"
import { useAudioRuntimeStore } from "../stores/audioRuntime"
import { useLiveMixer } from "../composables/useLiveMixer"
import DocumentWorkspaceShell from "../components/workspace/DocumentWorkspaceShell.vue"
import WorkspaceStatusbar from "../components/workspace/WorkspaceStatusbar.vue"
import MixerSurface from "../components/mixer/MixerSurface.vue"
import LiveTopbar from "../components/live/LiveTopbar.vue"
import LiveProjectPanel from "../components/live/LiveProjectPanel.vue"
import WorkspaceSidePanel from "../components/workspace/WorkspaceSidePanel.vue"
import LiveDeviceSettings from "../components/live/LiveDeviceSettings.vue"

const { t } = useI18n()
const router = useRouter()
const live = useLiveStore()
const audio = useAudioRuntimeStore()
const mixer = useLiveMixer()
const displayOptions: MixerStripDisplayOptions = {
  meterPeakHold: "800ms",
  meterReturnRate: DEFAULT_METER_RETURN_RATE,
  softwareMonitoringEnabled: true
}
const { graph, master, selectedChannelId, effectPlugins, instrumentPlugins, pluginRuntime } = mixer
const { workspace, pending, error } = storeToRefs(live)
const { runtime, statistics, warnings } = storeToRefs(audio)
const { leftPanelOpen, mixerOpen, mixerWidth } = storeToRefs(useLiveWorkspaceStore())
const { width: windowWidth } = useWindowSize()
const maximumMixerWidth = computed(() => Math.max(360, windowWidth.value - 414))
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
function silentMeter(): undefined {
  return undefined
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
      :pending="pending"
      :left-panel-open="leftPanelOpen"
      :mixer-open="mixerOpen"
      :master="master"
      @toggle-left-panel="leftPanelOpen = !leftPanelOpen"
      @toggle-mixer="mixerOpen = !mixerOpen"
      @configure="openDevices"
      @preview="mixer.preview"
      @update-channel="mixer.updateChannel"
    />
    <LiveProjectPanel
      v-if="leftPanelOpen"
      :name="workspace.session.configuration.name"
      :pending="pending"
      @configure="openDevices"
    />
    <section
      class="live-performance-workspace min-h-0 min-w-0 overflow-hidden bg-[var(--daw-workspace)]"
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
        :graph="graph"
        :selected-channel-id="selectedChannelId"
        :busy="pending"
        :can-undo="live.canUndo"
        :can-redo="live.canRedo"
        :error="error"
        :effect-plugins="effectPlugins"
        :instrument-plugins="instrumentPlugins"
        :plugin-runtime="pluginRuntime"
        :studio-controls="false"
        :application-capture-enabled="false"
        :plugin-editors-enabled="false"
        :meter-source="silentMeter"
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
        :pending="pending"
        :error="error"
        @configure="configure"
      />
    </UiDialog>
  </DocumentWorkspaceShell>
</template>
