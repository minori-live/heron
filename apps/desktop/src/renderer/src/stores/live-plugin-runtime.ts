import { onScopeDispose, shallowRef, watch, type ShallowRef } from "vue"
import type {
  LiveWorkspaceSnapshot,
  PluginRuntimeFailure,
  PluginRuntimeEvent,
  RpcError,
  RpcEvent
} from "@heron/contracts"

const PENDING_FAILURE_LIMIT = 128

/** Attribute returned native failures only to the published Live generation. */
export function livePluginRuntime(
  workspace: ShallowRef<LiveWorkspaceSnapshot | null>,
  audioHostEpoch: () => string | undefined,
  settling: () => boolean,
  operationFailed: (error: RpcError) => void
) {
  const failures = shallowRef<Record<string, PluginRuntimeFailure>>({})
  const pending = new Map<string, RpcEvent<PluginRuntimeFailure>>()
  let unsubscribe: (() => void) | null = null
  let epoch: string | undefined
  let documentKey: string | null = null
  let sequence = 0
  let nativeIds: Record<string, string> = {}

  function accept(documentId: string, failure: PluginRuntimeFailure): void {
    failures.value = {
      ...failures.value,
      [documentId]: { ...structuredClone(failure), instanceId: documentId }
    }
  }

  function receive(event: RpcEvent<PluginRuntimeEvent>): void {
    if (!workspace.value || event.sourceEpoch !== audioHostEpoch() || event.sequence <= sequence)
      return
    sequence = event.sequence
    const documentId = Object.keys(nativeIds).find(
      (id) => nativeIds[id] === event.payload.instanceId
    )
    if ("kind" in event.payload) {
      if (documentId) operationFailed(event.payload.error)
      return
    }
    const failureEvent: RpcEvent<PluginRuntimeFailure> = { ...event, payload: event.payload }
    if (documentId) {
      accept(documentId, event.payload)
    } else if (settling()) {
      pending.delete(event.payload.instanceId)
      pending.set(event.payload.instanceId, structuredClone(failureEvent))
      while (pending.size > PENDING_FAILURE_LIMIT) pending.delete(pending.keys().next().value!)
    }
  }

  watch(
    [workspace, audioHostEpoch, settling],
    () => {
      const current = workspace.value
      const nextKey = current
        ? `${current.project.epoch}:${current.project.id}:${current.project.generation}`
        : null
      const nextEpoch = audioHostEpoch()
      if (nextKey !== documentKey || nextEpoch !== epoch) {
        failures.value = {}
        pending.clear()
        sequence = 0
        nativeIds = {}
        documentKey = nextKey
        epoch = nextEpoch
      }
      if (!current) {
        unsubscribe?.()
        unsubscribe = null
        return
      }
      unsubscribe ??= window.heron.subscribePluginRuntime(receive)
      const nextIds = current.performance?.runtimePluginIds ?? {}
      failures.value = Object.fromEntries(
        Object.entries(failures.value).filter(
          ([id]) => nextIds[id] !== undefined && nextIds[id] === nativeIds[id]
        )
      )
      nativeIds = nextIds
      for (const [documentId, nativeId] of Object.entries(nextIds)) {
        const event = pending.get(nativeId)
        if (event && event.sourceEpoch === epoch) {
          accept(documentId, event.payload)
          pending.delete(nativeId)
        }
      }
      if (!settling()) pending.clear()
    },
    { immediate: true, flush: "sync" }
  )

  onScopeDispose(() => unsubscribe?.())
  return failures
}
