import { readFile } from "node:fs/promises"
import { join } from "node:path"

export interface BuiltinPluginSpec {
  id: string
  bundleName: string
  classId: string
  name: string
  kind: "effect" | "instrument"
}

// These identities are retained only to show an unavailable entry if the
// installed inventory cannot be trusted. Capabilities always come from a probe.
export const BUILTIN_PLUGIN_BASELINE: readonly BuiltinPluginSpec[] = [
  {
    id: "live.minori.heron.gain",
    bundleName: "Heron Gain.vst3",
    classId: "46774F504DF84B4AC1F308AB88DD3677",
    name: "Heron Gain",
    kind: "effect"
  },
  {
    id: "live.minori.heron.sine",
    bundleName: "Heron Sine.vst3",
    classId: "C1351DFA4DDD4B4AC1F30896F6D9DF76",
    name: "Heron Sine",
    kind: "instrument"
  },
  {
    id: "live.minori.heron.metronome",
    bundleName: "Heron Metronome.vst3",
    classId: "8CD16A11027ACC7FDF0C1419E86D1024",
    name: "Heron Metronome",
    kind: "instrument"
  }
]

export interface BuiltinPluginInventory {
  plugins: readonly BuiltinPluginSpec[]
  error: string | null
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function runtimePlatform(): string {
  if (process.platform === "darwin" && ["x64", "arm64"].includes(process.arch))
    return "macos-universal"
  if (process.platform === "win32" && process.arch === "x64") return "windows-x64"
  if (process.platform === "linux" && ["x64", "arm64"].includes(process.arch)) {
    return `linux-${process.arch}`
  }
  throw new Error("Unsupported bundled plug-in platform")
}

export function parseBuiltinPluginManifest(
  value: unknown,
  platform = runtimePlatform()
): BuiltinPluginSpec[] {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    typeof value.version !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(value.version) ||
    typeof value.sourceCommit !== "string" ||
    !/^[0-9a-f]{40}$/.test(value.sourceCommit) ||
    value.platform !== platform ||
    !Array.isArray(value.plugins) ||
    value.plugins.length === 0
  ) {
    throw new Error("Invalid bundled plug-in manifest or platform")
  }
  const ids = new Set<string>()
  const nativeIds = new Set<string>()
  const bundles = new Set<string>()
  return value.plugins.map((entry: unknown) => {
    if (
      !record(entry) ||
      entry.format !== "vst3" ||
      typeof entry.builtinId !== "string" ||
      !/^live\.minori\.heron\.[a-z0-9._-]+$/.test(entry.builtinId) ||
      typeof entry.nativeId !== "string" ||
      !/^[0-9A-F]{32}$/.test(entry.nativeId) ||
      typeof entry.bundleName !== "string" ||
      !/^[^/\\:]+\.vst3$/.test(entry.bundleName) ||
      entry.bundleName.startsWith(".") ||
      typeof entry.name !== "string" ||
      entry.name.trim().length === 0 ||
      !["effect", "instrument"].includes(String(entry.kind)) ||
      ids.has(entry.builtinId) ||
      nativeIds.has(entry.nativeId) ||
      bundles.has(entry.bundleName.toLowerCase())
    ) {
      throw new Error("Invalid or duplicate bundled plug-in entry")
    }
    const baseline = BUILTIN_PLUGIN_BASELINE.find((plugin) => plugin.id === entry.builtinId)
    if (baseline && (baseline.classId !== entry.nativeId || baseline.kind !== entry.kind)) {
      throw new Error("Bundled plug-in identity changed")
    }
    ids.add(entry.builtinId)
    nativeIds.add(entry.nativeId)
    bundles.add(entry.bundleName.toLowerCase())
    return {
      id: entry.builtinId,
      classId: entry.nativeId,
      bundleName: entry.bundleName,
      name: entry.name,
      kind: entry.kind as BuiltinPluginSpec["kind"]
    }
  })
}

export async function loadBuiltinPluginInventory(
  directory: string
): Promise<BuiltinPluginInventory> {
  try {
    const source = await readFile(join(directory, "bundle-manifest.json"), "utf8")
    return { plugins: parseBuiltinPluginManifest(JSON.parse(source)), error: null }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Inventory could not be read"
    return {
      plugins: BUILTIN_PLUGIN_BASELINE,
      error: `Bundled plug-in inventory unavailable: ${detail}`
    }
  }
}
