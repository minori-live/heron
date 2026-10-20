import { bindSnapshotPoll } from "./snapshot-poll"

export function useMixerMeterPolling(refresh: () => Promise<void>) {
  let active = false
  let refreshing = false
  let pending = false

  async function requestRefresh(): Promise<void> {
    if (refreshing) {
      pending = true
      return
    }
    refreshing = true
    try {
      do {
        pending = false
        await refresh()
      } while (active && pending)
    } finally {
      refreshing = false
    }
  }

  const polling = bindSnapshotPoll(() => void requestRefresh())

  function start(): void {
    if (active) return
    active = true
    polling.start()
  }

  function stop(): void {
    active = false
    pending = false
    polling.stop()
  }

  return { start, stop }
}
