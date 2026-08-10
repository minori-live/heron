import { describe, expect, it } from "vitest"
import { memorySnapshot, parseMacMemorySnapshot } from "./system-memory"

const PAGE_SIZE = 16_384

describe("macOS system memory sampling", () => {
  it("treats inactive and speculative pages as available without counting swap", () => {
    const totalBytes = 1_000 * PAGE_SIZE
    const snapshot = parseMacMemorySnapshot(
      `Mach Virtual Memory Statistics: (page size of ${PAGE_SIZE} bytes)
Pages free:                               100.
Pages active:                             500.
Pages inactive:                           200.
Pages speculative:                         50.
Pages wired down:                         100.
Pages occupied by compressor:              50.
Swapins:                                10000.
Swapouts:                                9000.
`,
      totalBytes
    )

    expect(snapshot).toEqual({
      totalBytes,
      usedBytes: 650 * PAGE_SIZE,
      freeBytes: 350 * PAGE_SIZE,
      usagePercent: 65
    })
  })

  it("accepts older vm_stat output without speculative pages", () => {
    const snapshot = parseMacMemorySnapshot(
      `Mach Virtual Memory Statistics: (page size of 4096 bytes)
Pages free: 10.
Pages inactive: 20.
`,
      100 * 4096
    )

    expect(snapshot?.freeBytes).toBe(30 * 4096)
  })

  it("rejects incomplete vm_stat output and bounds fallback values", () => {
    expect(parseMacMemorySnapshot("Pages free: 10.", 1_000)).toBeNull()
    expect(memorySnapshot(1_000, 2_000)).toEqual({
      totalBytes: 1_000,
      usedBytes: 0,
      freeBytes: 1_000,
      usagePercent: 0
    })
  })
})
