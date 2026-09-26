<script setup lang="ts">
import { onMounted } from "vue"
import { storeToRefs } from "pinia"
import { useRouter } from "vue-router"
import { useI18n } from "vue-i18n"
import ProjectWelcome from "../components/project/ProjectWelcome.vue"
import { useApplicationSettingsStore } from "../stores/applicationSettings"
import { useMixerStore } from "../stores/mixer"
import { useProjectStore } from "../stores/project"
import { useLiveStore } from "../stores/live"
import type { CreateProjectRequest } from "@heron/contracts"

const router = useRouter()
const { t } = useI18n()
const settingsStore = useApplicationSettingsStore()
const mixerStore = useMixerStore()
const projectStore = useProjectStore()
const liveStore = useLiveStore()
const { settings } = storeToRefs(settingsStore)
const { busy, error } = storeToRefs(projectStore)
const { pending: livePending, error: liveError } = storeToRefs(liveStore)

onMounted(() => void settingsStore.load())

async function create(request: CreateProjectRequest): Promise<void> {
  const workspace = await projectStore.create(request)
  if (!workspace) return
  mixerStore.hydrate(workspace.graph)
  void router.push({ name: "studio" })
}
async function open(path?: string): Promise<void> {
  const prepared = await projectStore.prepareDocumentOpen(path)
  if (!prepared) return
  if (prepared.kind === "live") {
    if (await liveStore.open(prepared.path)) void router.push({ name: "live" })
    return
  }
  const workspace = await projectStore.open(prepared.path)
  if (workspace) {
    mixerStore.hydrate(workspace.graph)
    void router.push({ name: "studio" })
  }
}

async function createLive(): Promise<void> {
  const workspace = await liveStore.create({
    name: t("welcome.untitledLive"),
    sampleRate: 48_000,
    audio: null,
    enabledMidiDeviceIds: []
  })
  if (workspace) void router.push({ name: "live" })
}
</script>

<template>
  <ProjectWelcome
    :settings="settings"
    :busy="busy || livePending"
    :error="error || liveError"
    @create="create"
    @create-live="createLive"
    @open="open"
  />
</template>
