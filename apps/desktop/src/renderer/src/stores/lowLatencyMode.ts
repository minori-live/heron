import { acceptHMRUpdate, defineStore } from "pinia"
import { computed, shallowRef } from "vue"
import type { LowLatencyModeConfiguration, LowLatencyModeSnapshot } from "@heron/contracts"
import { mutationMeta, readMeta, rpcErrorMessage } from "../rpc"
import { useAudioRuntimeStore } from "./audioRuntime"
import { useProjectStore } from "./project"
import { useTransportStore } from "./transport"

const EMPTY_SNAPSHOT: LowLatencyModeSnapshot = {
  enabled: false,
  targetOutputChannelId: null,
  pluginBudgetMs: 5,
  effectiveBudgetSamples: 0,
  bypassedPluginInstanceIds: [],
  unavoidableLatencySamples: 0,
  hasMonitoringPath: false
}

export const useLowLatencyModeStore = defineStore("low-latency-mode", () => {
  const audioRuntime = useAudioRuntimeStore()
  const project = useProjectStore()
  const transport = useTransportStore()
  const snapshot = shallowRef<LowLatencyModeSnapshot>({ ...EMPTY_SNAPSHOT })
  const applying = shallowRef(false)
  const error = shallowRef("")
  const resourceRevision = shallowRef(0)
  let requestGeneration = 0

  const enabled = computed(() => snapshot.value.enabled)
  const targetOutputChannelId = computed(() => snapshot.value.targetOutputChannelId)
  const pluginBudgetMs = computed(() => snapshot.value.pluginBudgetMs)
  const canConfigure = computed(
    () =>
      audioRuntime.audioEngineRef !== null &&
      transport.snapshot.state === "stopped" &&
      !applying.value
  )

  async function refreshNow(): Promise<boolean> {
    const target = audioRuntime.audioEngineRef
    if (!target) {
      snapshot.value = { ...EMPTY_SNAPSHOT }
      resourceRevision.value = 0
      return false
    }
    const generation = ++requestGeneration
    const result = await window.heron.lowLatencyModeSnapshot(readMeta(target))
    if (generation !== requestGeneration) return false
    if (!result.ok) {
      error.value = rpcErrorMessage(result.error)
      return false
    }
    snapshot.value = structuredClone(result.value)
    resourceRevision.value = result.resourceRevision ?? resourceRevision.value
    error.value = ""
    return true
  }

  async function refresh(): Promise<boolean> {
    return (await project.withProjectAccess(refreshNow)) ?? false
  }

  async function configure(configuration: LowLatencyModeConfiguration): Promise<boolean> {
    return (
      (await project.withProjectAccess(async () => {
        if (!canConfigure.value) return false
        const target = audioRuntime.audioEngineRef
        if (!target) return false
        applying.value = true
        error.value = ""
        try {
          let result = await window.heron.configureLowLatencyMode(
            mutationMeta(target, "low-latency-mode", resourceRevision.value),
            configuration
          )
          if (!result.ok && result.error.retry === "after-reconcile") {
            if (!(await refreshNow()) || !audioRuntime.audioEngineRef) return false
            result = await window.heron.configureLowLatencyMode(
              mutationMeta(audioRuntime.audioEngineRef, "low-latency-mode", resourceRevision.value),
              configuration
            )
          }
          if (!result.ok) {
            if (result.error.outcome === "unknown") await refreshNow()
            error.value = rpcErrorMessage(result.error)
            return false
          }
          snapshot.value = structuredClone(result.value)
          resourceRevision.value = result.resourceRevision ?? resourceRevision.value
          return true
        } finally {
          applying.value = false
        }
      })) ?? false
    )
  }

  function toggle(): Promise<boolean> {
    return configure({ enabled: !snapshot.value.enabled })
  }

  function selectOutput(targetOutputChannelId: string): Promise<boolean> {
    return configure({ targetOutputChannelId })
  }

  function setPluginBudget(pluginBudgetMs: number): Promise<boolean> {
    return configure({ pluginBudgetMs })
  }

  function reset(): void {
    requestGeneration += 1
    snapshot.value = { ...EMPTY_SNAPSHOT }
    resourceRevision.value = 0
    error.value = ""
    applying.value = false
  }

  return {
    snapshot,
    applying,
    error,
    resourceRevision,
    enabled,
    targetOutputChannelId,
    pluginBudgetMs,
    canConfigure,
    refresh,
    configure,
    toggle,
    selectOutput,
    setPluginBudget,
    reset
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useLowLatencyModeStore, import.meta.hot))
}
