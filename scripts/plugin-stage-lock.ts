import { open } from "node:fs/promises"
import { createRequire } from "node:module"
import { setTimeout } from "node:timers/promises"

const locks = createRequire(import.meta.url)("fs-native-extensions") as {
  tryLock(fd: number): boolean
  unlock(fd: number): void
}

// The gate file is permanent: unlinking or replacing it would let callers lock
// different inodes for the same stage. The kernel owns the lock's lifetime and
// releases it when the descriptor closes, including when its process crashes.
export async function acquirePluginStageLock(
  path: string,
  timeoutMs = 60_000
): Promise<() => Promise<void>> {
  const file = await open(path, "a+")
  const deadline = performance.now() + timeoutMs
  try {
    // tryLock defaults to exclusive and reports contention without blocking a
    // Node thread. Separate opens also exclude callers in this same process.
    while (!locks.tryLock(file.fd)) {
      if (performance.now() >= deadline)
        throw new Error("Plug-in staging is busy; retry after the other prepare command finishes")
      await setTimeout(Math.min(100, Math.max(1, deadline - performance.now())))
    }
  } catch (error) {
    await file.close()
    throw error
  }
  let released: Promise<void> | undefined
  return () => {
    released ??= (async () => {
      try {
        locks.unlock(file.fd)
      } finally {
        await file.close()
      }
    })()
    return released
  }
}
