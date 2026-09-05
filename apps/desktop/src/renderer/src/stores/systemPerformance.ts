import { useIntervalFn } from "@vueuse/core"
import { acceptHMRUpdate, defineStore } from "pinia"
import { computed, shallowRef } from "vue"
import type { StorageSpaceSnapshot, SystemPerformanceSnapshot } from "@heron/contracts"
import { readMeta, rpcErrorMessage } from "../rpc"
import { useProjectStore } from "./project"

import { i18n } from "../i18n"

function t(key: string, params?: Record<string, string | number>): string {
  return i18n.global.t(key, params ?? {})
}

const POLLING_INTERVAL_MS = 1_000
const GIBIBYTE = 1024 ** 3

export type HealthSeverity = "normal" | "warning" | "critical"

export interface PerformanceWarning {
  id: string
  severity: Exclude<HealthSeverity, "normal">
  title: string
  message: string
}

export const PERFORMANCE_THRESHOLDS = {
  cpu: { warningPercent: 70, criticalPercent: 90 },
  memory: { warningPercent: 75, criticalPercent: 90 },
  storage: {
    warningFreePercent: 15,
    criticalFreePercent: 5,
    warningFreeBytes: 20 * GIBIBYTE,
    criticalFreeBytes: 5 * GIBIBYTE
  },
  audioRoundTrip: { warningMs: 20, criticalMs: 40 },
  audioRuntime: {
    warningUtilizationPercent: 75,
    criticalUtilizationPercent: 90,
    warningHeartbeatAgeMs: 750,
    criticalHeartbeatAgeMs: 1_500
  }
} as const

function severityRank(severity: HealthSeverity): number {
  if (severity === "critical") return 2
  if (severity === "warning") return 1
  return 0
}

export function highestSeverity(severities: HealthSeverity[]): HealthSeverity {
  return severities.reduce<HealthSeverity>(
    (highest, severity) => (severityRank(severity) > severityRank(highest) ? severity : highest),
    "normal"
  )
}

export function classifyUpperBound(
  value: number | null,
  warningThreshold: number,
  criticalThreshold: number
): HealthSeverity {
  if (value === null) return "normal"
  if (value >= criticalThreshold) return "critical"
  if (value >= warningThreshold) return "warning"
  return "normal"
}

function utilizationPercent(used: number, capacity: number): number {
  return capacity > 0 ? (used / capacity) * 100 : 0
}

export function storageSeverity(space: StorageSpaceSnapshot): HealthSeverity {
  if (space.state === "unavailable") return "warning"
  if (
    space.state !== "available" ||
    space.totalBytes === null ||
    space.freeBytes === null ||
    space.totalBytes <= 0
  ) {
    return "normal"
  }

  const freePercent = (space.freeBytes / space.totalBytes) * 100
  if (
    freePercent <= PERFORMANCE_THRESHOLDS.storage.criticalFreePercent ||
    space.freeBytes <= PERFORMANCE_THRESHOLDS.storage.criticalFreeBytes
  ) {
    return "critical"
  }
  if (
    freePercent <= PERFORMANCE_THRESHOLDS.storage.warningFreePercent ||
    space.freeBytes <= PERFORMANCE_THRESHOLDS.storage.warningFreeBytes
  ) {
    return "warning"
  }
  return "normal"
}

export const useSystemPerformanceStore = defineStore("system-performance", () => {
  const snapshot = shallowRef<SystemPerformanceSnapshot | null>(null)
  const projectStore = useProjectStore()
  const lastError = shallowRef("")
  const isRefreshing = shallowRef(false)

  async function refresh(): Promise<void> {
    if (isRefreshing.value) return
    isRefreshing.value = true
    try {
      const target = projectStore.desktopSession
      if (!target) return
      const result = await window.heron.systemPerformanceSnapshot(readMeta(target))
      if (!result.ok) {
        lastError.value = rpcErrorMessage(result.error)
        return
      }
      snapshot.value = result.value
      lastError.value = ""
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : t("performance.warnings.readError")
    } finally {
      isRefreshing.value = false
    }
  }

  const polling = useIntervalFn(() => void refresh(), POLLING_INTERVAL_MS, { immediate: false })

  function startPolling(): void {
    void refresh()
    polling.resume()
  }

  function stopPolling(): void {
    polling.pause()
  }

  const maximumCoreUsagePercent = computed<number | null>(() => {
    const values =
      snapshot.value?.cpu.cores
        .map((core) => core.usagePercent)
        .filter((value): value is number => value !== null) ?? []
    return values.length > 0 ? Math.max(...values) : null
  })

  const warnings = computed<PerformanceWarning[]>(() => {
    const result: PerformanceWarning[] = []
    const current = snapshot.value

    if (lastError.value) {
      result.push({
        id: "system-monitor-unavailable",
        severity: "warning",
        title: t("performance.warnings.unavailable"),
        message: lastError.value
      })
    }
    if (!current) return result

    const cpuSeverity = highestSeverity([
      classifyUpperBound(
        current.cpu.overallUsagePercent,
        PERFORMANCE_THRESHOLDS.cpu.warningPercent,
        PERFORMANCE_THRESHOLDS.cpu.criticalPercent
      ),
      classifyUpperBound(
        maximumCoreUsagePercent.value,
        PERFORMANCE_THRESHOLDS.cpu.warningPercent,
        PERFORMANCE_THRESHOLDS.cpu.criticalPercent
      )
    ])
    if (cpuSeverity !== "normal") {
      result.push({
        id: "cpu-pressure",
        severity: cpuSeverity,
        title:
          cpuSeverity === "critical"
            ? t("performance.warnings.cpuCritical")
            : t("performance.warnings.cpuWarning"),
        message: t("performance.warnings.cpuMessage", {
          percent: Math.round(maximumCoreUsagePercent.value ?? 0)
        })
      })
    }

    const memorySeverity = classifyUpperBound(
      current.memory.usagePercent,
      PERFORMANCE_THRESHOLDS.memory.warningPercent,
      PERFORMANCE_THRESHOLDS.memory.criticalPercent
    )
    if (memorySeverity !== "normal") {
      result.push({
        id: "memory-pressure",
        severity: memorySeverity,
        title:
          memorySeverity === "critical"
            ? t("performance.warnings.memoryCritical")
            : t("performance.warnings.memoryWarning"),
        message: t("performance.warnings.memoryMessage", {
          percent: Math.round(current.memory.usagePercent)
        })
      })
    }

    for (const space of current.storage) {
      const severity = storageSeverity(space)
      if (severity === "normal") continue
      const label =
        space.id === "workspace"
          ? t("performance.warnings.workspace")
          : t("performance.warnings.swap")
      result.push({
        id: `${space.id}-storage`,
        severity,
        title:
          space.state === "unavailable"
            ? t("performance.warnings.storageUnavailable", { label })
            : t("performance.warnings.storageLow", { label }),
        message:
          space.state === "unavailable"
            ? t("performance.warnings.storageUnavailableMessage")
            : t("performance.warnings.storageLowMessage")
      })
    }

    const audioRuntime = current.audioRuntime
    if (audioRuntime) {
      const heartbeatSeverity = classifyUpperBound(
        audioRuntime.heartbeat.ageMs,
        PERFORMANCE_THRESHOLDS.audioRuntime.warningHeartbeatAgeMs,
        PERFORMANCE_THRESHOLDS.audioRuntime.criticalHeartbeatAgeMs
      )
      if (heartbeatSeverity !== "normal") {
        result.push({
          id: "audio-runtime-heartbeat",
          severity: heartbeatSeverity,
          title:
            heartbeatSeverity === "critical"
              ? t("performance.warnings.heartbeatCritical")
              : t("performance.warnings.heartbeatWarning"),
          message: t("performance.warnings.heartbeatMessage", {
            age: Math.round(audioRuntime.heartbeat.ageMs ?? 0)
          })
        })
      }

      const requestUtilization = Math.max(
        utilizationPercent(audioRuntime.requests.normalPending, audioRuntime.requests.capacity),
        utilizationPercent(audioRuntime.eventQueueDepth, audioRuntime.requests.capacity)
      )
      const requestSeverity = classifyUpperBound(
        requestUtilization,
        PERFORMANCE_THRESHOLDS.audioRuntime.warningUtilizationPercent,
        PERFORMANCE_THRESHOLDS.audioRuntime.criticalUtilizationPercent
      )
      if (requestSeverity !== "normal") {
        result.push({
          id: "audio-runtime-queue-pressure",
          severity: requestSeverity,
          title:
            requestSeverity === "critical"
              ? t("performance.warnings.queueCritical")
              : t("performance.warnings.queueWarning"),
          message: t("performance.warnings.queueMessage", {
            percent: Math.round(requestUtilization)
          })
        })
      }

      const parameterRingUtilization = utilizationPercent(
        audioRuntime.parameterRing.used,
        audioRuntime.parameterRing.capacity
      )
      const parameterRingSeverity = classifyUpperBound(
        parameterRingUtilization,
        PERFORMANCE_THRESHOLDS.audioRuntime.warningUtilizationPercent,
        PERFORMANCE_THRESHOLDS.audioRuntime.criticalUtilizationPercent
      )
      if (parameterRingSeverity !== "normal") {
        result.push({
          id: "audio-runtime-parameter-pressure",
          severity: parameterRingSeverity,
          title:
            parameterRingSeverity === "critical"
              ? t("performance.warnings.parameterCritical")
              : t("performance.warnings.parameterWarning"),
          message: t("performance.warnings.parameterMessage", {
            percent: Math.round(parameterRingUtilization)
          })
        })
      }
    }

    return result
  })

  const severity = computed<HealthSeverity>(() =>
    highestSeverity(warnings.value.map((warning) => warning.severity))
  )

  return {
    snapshot,
    lastError,
    isRefreshing,
    maximumCoreUsagePercent,
    warnings,
    severity,
    refresh,
    startPolling,
    stopPolling
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useSystemPerformanceStore, import.meta.hot))
}
