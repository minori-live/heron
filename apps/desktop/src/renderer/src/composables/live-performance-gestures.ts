import type { LivePerformanceCommand } from "@heron/contracts"
import { captureFieldKey } from "@heron/project-model"
import type { useLiveStore } from "../stores/live"

/** Bound gesture traffic to one request and the latest value for each touched field. */
export function livePerformanceGestures(live: ReturnType<typeof useLiveStore>) {
  const queued = new Map<
    string,
    {
      command: LivePerformanceCommand
      generation: number
      settles: Array<(committed: boolean) => void>
    }
  >()
  let draining = false

  async function drain(): Promise<void> {
    if (draining) return
    draining = true
    try {
      while (queued.size) {
        const [key, entry] = queued.entries().next().value!
        queued.delete(key)
        const committed =
          live.performing && live.workspace?.performance?.generation === entry.generation
            ? await live.adjust(entry.command, entry.generation)
            : false
        for (const settle of entry.settles) settle(committed)
        if (!committed) {
          for (const pending of queued.values()) for (const settle of pending.settles) settle(false)
          queued.clear()
        }
      }
    } finally {
      draining = false
    }
  }

  return (command: LivePerformanceCommand): Promise<boolean> => {
    const generation = live.workspace?.performance?.generation
    if (!live.performing || generation === undefined) return Promise.resolve(false)
    const key = captureFieldKey(command)
    const previous = queued.get(key)
    const result = new Promise<boolean>((settle) => {
      queued.set(key, {
        command,
        generation,
        settles: [...(previous?.settles ?? []), settle]
      })
    })
    void drain()
    return result
  }
}
