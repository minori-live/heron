export interface IpcTraffic {
  channel: string
  messages: number
  bytes: number
}

const totals = new Map<string, IpcTraffic>()

export function recordIpcTraffic(channel: string, bytes: number): void {
  const current = totals.get(channel)
  if (current) {
    current.messages += 1
    current.bytes += bytes
    return
  }
  totals.set(channel, { channel, messages: 1, bytes })
}

export function ipcTraffic(): IpcTraffic[] {
  return [...totals.values()].map((entry) => ({ ...entry }))
}

export function resetIpcTraffic(): void {
  totals.clear()
}

/** Estimated structured-clone payload of one mixer meter snapshot. */
export function mixerSnapshotBytes(meters: readonly { channelId: string }[]): number {
  let channelBytes = 0
  for (const meter of meters) channelBytes += meter.channelId.length
  return channelBytes + meters.length * (6 * 8 + 1) + 24
}

/** Estimated structured-clone payload of one transport snapshot. */
export function transportSnapshotBytes(): number {
  return 96
}
