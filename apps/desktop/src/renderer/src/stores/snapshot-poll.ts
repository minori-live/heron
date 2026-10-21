const SNAPSHOT_POLL_MS = 33

type SnapshotPollJob = () => void

const jobs = new Set<SnapshotPollJob>()
let timer: ReturnType<typeof setInterval> | undefined

function ensureTimer(): void {
  if (timer !== undefined) return
  timer = setInterval(() => {
    for (const job of jobs) job()
  }, SNAPSHOT_POLL_MS)
}

/** Shares one 33 ms wake-up across mixer-meter and transport snapshot reads. */
export function bindSnapshotPoll(job: SnapshotPollJob): {
  start: () => void
  stop: () => void
} {
  return {
    start() {
      jobs.add(job)
      job()
      ensureTimer()
    },
    stop() {
      jobs.delete(job)
      if (jobs.size === 0 && timer !== undefined) {
        clearInterval(timer)
        timer = undefined
      }
    }
  }
}

/** Drops the shared timer so unit tests do not leak it across cases. */
export function resetSnapshotPollForTests(): void {
  if (timer !== undefined) clearInterval(timer)
  timer = undefined
  jobs.clear()
}
