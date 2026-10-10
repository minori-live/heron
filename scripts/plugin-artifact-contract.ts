export const PLUGIN_REPOSITORY = "minori-live/heron-plugins"
export const PLUGIN_PLATFORMS = [
  "macos-universal",
  "windows-x64",
  "linux-x64",
  "linux-arm64"
] as const
export type PluginPlatform = (typeof PLUGIN_PLATFORMS)[number]

export interface PluginAsset {
  file: string
  sha256: string
}
export interface PluginRelease {
  version: string
  sourceCommit: string
  assets: Record<PluginPlatform, { runtime: PluginAsset; symbols: PluginAsset }>
}
export interface PluginLock {
  schemaVersion: 1
  repository: typeof PLUGIN_REPOSITORY
  release: PluginRelease | null
}
export interface BuiltinBundle {
  builtinId: string
  name: string
  kind: "effect" | "instrument"
  format: "vst3"
  nativeId: string
  bundleName: string
}
export interface BundleManifest {
  schemaVersion: 1
  version: string
  sourceCommit: string
  platform: PluginPlatform
  plugins: BuiltinBundle[]
}
export interface SymbolsManifest {
  schemaVersion: 1
  version: string
  sourceCommit: string
  platform: PluginPlatform
  format: "vst3"
  modules: Array<{ modulePath: string; binaryPath: string; debugId: string; arch: "x64" | "arm64" }>
}

// These identities are persisted in existing projects; Metronome also belongs
// to the default project and Gain supplies the host's benchmark processor.
export const REQUIRED_BUILTINS: readonly BuiltinBundle[] = [
  {
    builtinId: "live.minori.heron.eq",
    name: "Heron EQ",
    kind: "effect",
    format: "vst3",
    nativeId: "8A8341D5CA36B6C9A9572788F40EBB9F",
    bundleName: "Heron EQ.vst3"
  },
  {
    builtinId: "live.minori.heron.gain",
    name: "Heron Gain",
    kind: "effect",
    format: "vst3",
    nativeId: "46774F504DF84B4AC1F308AB88DD3677",
    bundleName: "Heron Gain.vst3"
  },
  {
    builtinId: "live.minori.heron.sine",
    name: "Heron Sine",
    kind: "instrument",
    format: "vst3",
    nativeId: "C1351DFA4DDD4B4AC1F30896F6D9DF76",
    bundleName: "Heron Sine.vst3"
  },
  {
    builtinId: "live.minori.heron.metronome",
    name: "Heron Metronome",
    kind: "instrument",
    format: "vst3",
    nativeId: "8CD16A11027ACC7FDF0C1419E86D1024",
    bundleName: "Heron Metronome.vst3"
  }
]

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a plug-in artifact object")
  }
  return value as Record<string, unknown>
}

export function stablePluginVersion(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(value) ||
    !value.split(".").every((part) => Number.isSafeInteger(Number(part)))
  ) {
    throw new Error("Plug-in releases require a stable semver version")
  }
  return value
}

export function pluginPlatform(value: unknown): PluginPlatform {
  if (!PLUGIN_PLATFORMS.includes(value as PluginPlatform)) {
    throw new Error(`Unsupported plug-in platform: ${String(value)}`)
  }
  return value as PluginPlatform
}

export function currentPluginPlatform(
  platform = process.platform,
  arch = process.arch
): PluginPlatform {
  if (platform === "darwin" && (arch === "arm64" || arch === "x64")) return "macos-universal"
  if (platform === "win32" && arch === "x64") return "windows-x64"
  if (platform === "linux" && arch === "x64") return "linux-x64"
  if (platform === "linux" && arch === "arm64") return "linux-arm64"
  throw new Error(`Unsupported plug-in host: ${platform}/${arch}`)
}

function commit(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error("Plug-in sourceCommit must be a full Git commit")
  }
  return value
}

export function pluginAssetName(
  version: string,
  platform: PluginPlatform,
  symbols = false
): string {
  return `heron-plugins-${version}-${platform}-vst3${symbols ? "-symbols" : ""}.zip`
}

export function pluginBinaryPath(bundleName: string, platform: PluginPlatform): string {
  const stem = bundleName.slice(0, -5)
  const binary =
    platform === "macos-universal"
      ? `Contents/MacOS/${stem}`
      : platform === "windows-x64"
        ? `Contents/x86_64-win/${stem}.vst3`
        : `Contents/${platform === "linux-arm64" ? "aarch64" : "x86_64"}-linux/${stem}.so`
  return `bundles/${bundleName}/${binary}`
}

function asset(value: unknown, filename: string): PluginAsset {
  const item = object(value)
  if (
    item.file !== filename ||
    typeof item.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(item.sha256)
  ) {
    throw new Error(`Invalid locked plug-in asset: ${filename}`)
  }
  return { file: filename, sha256: item.sha256 }
}

export function parsePluginLock(value: unknown): PluginLock {
  const lock = object(value)
  if (lock.schemaVersion !== 1 || lock.repository !== PLUGIN_REPOSITORY) {
    throw new Error("Unsupported plug-in lock schema or repository")
  }
  if (lock.release === null)
    return { schemaVersion: 1, repository: PLUGIN_REPOSITORY, release: null }
  const release = object(lock.release)
  const version = stablePluginVersion(release.version)
  const assets = object(release.assets)
  return {
    schemaVersion: 1,
    repository: PLUGIN_REPOSITORY,
    release: {
      version,
      sourceCommit: commit(release.sourceCommit),
      assets: Object.fromEntries(
        PLUGIN_PLATFORMS.map((platform) => {
          const files = object(assets[platform])
          return [
            platform,
            {
              runtime: asset(files.runtime, pluginAssetName(version, platform)),
              symbols: asset(files.symbols, pluginAssetName(version, platform, true))
            }
          ]
        })
      ) as PluginRelease["assets"]
    }
  }
}

export function artifactRelativePath(value: unknown): string {
  if (typeof value !== "string" || !value || value.includes("\\") || value.includes("\0")) {
    throw new Error("Invalid plug-in archive path")
  }
  const parts = value.replace(/\/$/u, "").split("/")
  if (
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        /[<>:"|?*]/u.test(part) ||
        [...part].some((character) => character.charCodeAt(0) < 32) ||
        /[. ]$/u.test(part) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part)
    )
  ) {
    throw new Error(`Unsafe plug-in archive path: ${value}`)
  }
  return parts.join("/")
}

function manifestHeader(
  value: unknown,
  release: PluginRelease,
  platform: PluginPlatform
): Record<string, unknown> {
  const manifest = object(value)
  if (
    manifest.schemaVersion !== 1 ||
    manifest.version !== release.version ||
    manifest.sourceCommit !== release.sourceCommit ||
    manifest.platform !== platform
  ) {
    throw new Error("Plug-in manifest does not match the locked release/platform")
  }
  return manifest
}

export function parseBundleManifest(
  value: unknown,
  release: PluginRelease,
  platform: PluginPlatform
): BundleManifest {
  const manifest = manifestHeader(value, release, platform)
  if (!Array.isArray(manifest.plugins) || manifest.plugins.length === 0)
    throw new Error("Empty plug-in manifest")
  const plugins = manifest.plugins.map((value): BuiltinBundle => {
    const item = object(value)
    if (
      typeof item.builtinId !== "string" ||
      !/^live\.minori\.heron\.[a-z0-9._-]+$/u.test(item.builtinId) ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      (item.kind !== "effect" && item.kind !== "instrument") ||
      item.format !== "vst3" ||
      typeof item.nativeId !== "string" ||
      !/^[0-9A-F]{32}$/u.test(item.nativeId)
    ) {
      throw new Error("Invalid VST3 plug-in manifest entry")
    }
    const bundleName = artifactRelativePath(item.bundleName)
    if (bundleName.includes("/") || !bundleName.endsWith(".vst3"))
      throw new Error("Invalid VST3 bundle name")
    return {
      builtinId: item.builtinId,
      name: item.name,
      kind: item.kind,
      format: "vst3",
      nativeId: item.nativeId,
      bundleName
    }
  })
  for (const key of ["builtinId", "nativeId", "bundleName"] as const) {
    if (new Set(plugins.map((item) => item[key].toLowerCase())).size !== plugins.length)
      throw new Error(`Duplicate plug-in ${key}`)
  }
  for (const required of REQUIRED_BUILTINS) {
    const actual = plugins.find((plugin) => plugin.builtinId === required.builtinId)
    if (!actual || actual.nativeId !== required.nativeId || actual.kind !== required.kind)
      throw new Error(`Missing or incompatible required plug-in: ${required.builtinId}`)
  }
  return {
    schemaVersion: 1,
    version: release.version,
    sourceCommit: release.sourceCommit,
    platform,
    plugins
  }
}

export function parseSymbolsManifest(
  value: unknown,
  release: PluginRelease,
  platform: PluginPlatform
): SymbolsManifest {
  const manifest = manifestHeader(value, release, platform)
  if (
    manifest.format !== "vst3" ||
    !Array.isArray(manifest.modules) ||
    manifest.modules.length === 0
  )
    throw new Error("Invalid plug-in symbols manifest")
  const arches =
    platform === "macos-universal"
      ? ["x64", "arm64"]
      : [platform.endsWith("arm64") ? "arm64" : "x64"]
  const modules = manifest.modules.map((value): SymbolsManifest["modules"][number] => {
    const item = object(value)
    const modulePath = artifactRelativePath(item.modulePath)
    const binaryPath = artifactRelativePath(item.binaryPath)
    if (
      !modulePath.startsWith("symbols/") ||
      !binaryPath.startsWith("bundles/") ||
      typeof item.debugId !== "string" ||
      !item.debugId.trim() ||
      !arches.includes(String(item.arch))
    )
      throw new Error("Invalid plug-in debug module")
    return { modulePath, binaryPath, debugId: item.debugId, arch: item.arch as "x64" | "arm64" }
  })
  if (new Set(modules.map((item) => `${item.modulePath}:${item.arch}`)).size !== modules.length)
    throw new Error("Duplicate plug-in debug module")
  for (const arch of arches)
    if (!modules.some((module) => module.arch === arch))
      throw new Error(`Missing ${arch} plug-in symbols`)
  return {
    schemaVersion: 1,
    version: release.version,
    sourceCommit: release.sourceCommit,
    platform,
    format: "vst3",
    modules
  }
}
