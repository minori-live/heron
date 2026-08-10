import { execFile } from "node:child_process"
import { freemem, totalmem } from "node:os"
import type { MemorySnapshot } from "@heron/contracts"

const MAC_MEMORY_CACHE_MS = 5_000
const VM_STAT_TIMEOUT_MS = 750

let macMemoryCache: { expiresAt: number; snapshot: MemorySnapshot } | null = null
let macMemoryInFlight: Promise<MemorySnapshot | null> | null = null

function percentage(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.min(100, Math.max(0, (numerator / denominator) * 100))
}

export function memorySnapshot(totalBytes: number, availableBytes: number): MemorySnapshot {
  const boundedAvailable = Math.min(totalBytes, Math.max(0, availableBytes))
  const usedBytes = Math.max(0, totalBytes - boundedAvailable)
  return {
    totalBytes,
    usedBytes,
    freeBytes: boundedAvailable,
    usagePercent: percentage(usedBytes, totalBytes)
  }
}

/**
 * Parse macOS VM counters into effective physical-memory availability.
 *
 * Inactive and speculative pages can be reclaimed without paging them back in,
 * so counting only `Pages free` substantially overstates memory use. Compressed
 * pages still occupy physical RAM and intentionally remain in the used total.
 * Swap counters are not part of `vm_stat` physical page totals and are ignored.
 */
export function parseMacMemorySnapshot(output: string, totalBytes: number): MemorySnapshot | null {
  const pageSize = Number(output.match(/page size of (?<bytes>\d+) bytes/u)?.groups?.bytes)
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) return null

  const pages = new Map<string, number>()
  for (const line of output.split(/\r?\n/u)) {
    const match = line
      .trim()
      .match(/^Pages (?<name>free|inactive|speculative):\s+(?<count>\d+)\.?$/u)
    const name = match?.groups?.name
    const count = match?.groups?.count
    if (!name || !count) continue
    pages.set(name, Number(count))
  }

  const free = pages.get("free")
  const inactive = pages.get("inactive")
  if (free === undefined || inactive === undefined) return null
  const speculative = pages.get("speculative") ?? 0
  const availablePages = free + inactive + speculative
  if (!Number.isSafeInteger(availablePages) || availablePages < 0) return null

  return memorySnapshot(totalBytes, availablePages * pageSize)
}

function readMacVmStat(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "/usr/bin/vm_stat",
      [],
      { encoding: "utf8", timeout: VM_STAT_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => {
        if (error) reject(new Error("Failed to sample macOS virtual memory", { cause: error }))
        else resolve(stdout)
      }
    )
  })
}

async function sampleMacMemory(totalBytes: number): Promise<MemorySnapshot | null> {
  const now = Date.now()
  if (macMemoryCache && now < macMemoryCache.expiresAt) return macMemoryCache.snapshot

  macMemoryInFlight ??= readMacVmStat()
    .then((output) => parseMacMemorySnapshot(output, totalBytes))
    .catch(() => null)
    .finally(() => {
      macMemoryInFlight = null
    })

  const snapshot = await macMemoryInFlight
  if (snapshot) macMemoryCache = { expiresAt: now + MAC_MEMORY_CACHE_MS, snapshot }
  return snapshot
}

export async function sampleSystemMemory(): Promise<MemorySnapshot> {
  const totalBytes = totalmem()
  const fallback = memorySnapshot(totalBytes, freemem())
  if (process.platform !== "darwin") return fallback
  return (await sampleMacMemory(totalBytes)) ?? fallback
}
