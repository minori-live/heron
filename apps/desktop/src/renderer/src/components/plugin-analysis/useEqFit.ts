import { onScopeDispose, shallowRef, watch } from "vue"
import type { EqFitResult } from "../../lib/eq-fit"
import type { EqFitError, EqFitInput, EqFitSuccess } from "./eqFitWorkerTypes"

export function useEqFit(identity: () => readonly unknown[]) {
  const status = shallowRef<"idle" | "running" | "complete" | "cancelled" | "failed">("idle")
  const result = shallowRef<EqFitSuccess | null>(null)
  const error = shallowRef<EqFitError | null>(null)
  let worker: Worker | null = null
  let generation = 0

  function release(): void {
    generation += 1
    worker?.terminate()
    worker = null
  }

  function clear(): void {
    release()
    result.value = null
    error.value = null
    status.value = "idle"
  }

  function cancel(): void {
    clear()
    status.value = "cancelled"
  }

  function start(input: EqFitInput): void {
    clear()
    const current = generation
    status.value = "running"
    try {
      worker = new Worker(new URL("./eqFit.worker.ts", import.meta.url), { type: "module" })
      worker.onmessage = (event: MessageEvent<EqFitResult>) => {
        if (current !== generation) return
        release()
        if (event.data.ok) {
          result.value = event.data
          status.value = "complete"
        } else {
          error.value = event.data.code
          status.value = "failed"
        }
      }
      const fail = () => {
        if (current !== generation) return
        release()
        error.value = "worker-failed"
        status.value = "failed"
      }
      worker.onerror = fail
      worker.onmessageerror = fail
      worker.postMessage(input)
    } catch {
      release()
      error.value = "worker-failed"
      status.value = "failed"
    }
  }

  // Synchronous invalidation closes the gap before a queued worker reply arrives.
  watch(identity, clear, { flush: "sync" })
  onScopeDispose(release)
  return { status, result, error, start, cancel }
}
