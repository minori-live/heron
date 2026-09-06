import { readFile, readdir } from "node:fs/promises"
import { dirname, join, relative, resolve, sep } from "node:path"
import { describe, expect, it } from "vitest"

const mainRoot = join(import.meta.dirname, "..")
const domains = [
  "app",
  "audio-host",
  "audio",
  "ipc",
  "kernel",
  "plugins",
  "project",
  "recording",
  "settings",
  "updates"
] as const
type MainDomain = (typeof domains)[number]

const allowedDependencies: Readonly<Record<MainDomain, readonly MainDomain[]>> = {
  app: domains,
  ipc: domains,
  kernel: [],
  updates: [],
  settings: ["kernel"],
  "audio-host": ["kernel", "plugins", "settings"],
  plugins: ["audio-host", "kernel", "settings"],
  project: ["audio-host", "kernel", "plugins", "settings"],
  audio: ["audio-host", "project"],
  recording: ["audio", "audio-host", "kernel", "project", "settings"]
}

async function typescriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return typescriptFiles(path)
      return entry.name.endsWith(".ts") ? [path] : []
    })
  )
  return nested.flat()
}

function domainOf(path: string): MainDomain | null {
  const [firstSegment] = relative(mainRoot, path).split(sep)
  return domains.find((domain) => domain === firstSegment) ?? null
}

function relativeSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  const pattern = /(?:from\s+|import\s*\(|vi\.mock\s*\()\s*["']([^"']+)["']/g
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1]
    if (specifier?.startsWith(".")) specifiers.push(specifier)
  }
  return specifiers
}

describe("Electron main domain architecture", () => {
  it("keeps cross-domain imports on public barrels", async () => {
    const violations: string[] = []
    for (const file of await typescriptFiles(mainRoot)) {
      const sourceDomain = domainOf(file)
      const source = await readFile(file, "utf8")
      for (const specifier of relativeSpecifiers(source)) {
        const target = resolve(dirname(file), specifier)
        const targetDomain = domainOf(target)
        if (!sourceDomain || !targetDomain || sourceDomain === targetDomain) continue
        if (target !== join(mainRoot, targetDomain)) {
          violations.push(`${relative(mainRoot, file)} -> ${specifier}`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it("enforces the main domain dependency direction", async () => {
    const violations: string[] = []
    for (const file of await typescriptFiles(mainRoot)) {
      const sourceDomain = domainOf(file)
      if (!sourceDomain) continue
      const source = await readFile(file, "utf8")
      for (const specifier of relativeSpecifiers(source)) {
        const targetDomain = domainOf(resolve(dirname(file), specifier))
        if (!targetDomain || sourceDomain === targetDomain) continue
        if (!allowedDependencies[sourceDomain].includes(targetDomain)) {
          violations.push(`${sourceDomain} -> ${targetDomain}: ${relative(mainRoot, file)}`)
        }
      }
    }
    expect(violations).toEqual([])
  })
})
