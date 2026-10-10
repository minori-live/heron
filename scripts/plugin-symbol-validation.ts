import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { join } from "node:path"
import {
  parseBundleManifest,
  parseSymbolsManifest,
  pluginBinaryPath,
  type PluginPlatform,
  type PluginRelease
} from "./plugin-artifact-contract.ts"

export interface PluginDebugInfo {
  variants: Array<{ debug_id: string; arch: string }>
  features: string
  is_usable: boolean
}
export type PluginDebugInspector = (path: string) => PluginDebugInfo | Promise<PluginDebugInfo>

export function inspectPluginDebugInfo(path: string): PluginDebugInfo {
  const require = createRequire(new URL("../apps/desktop/package.json", import.meta.url))
  return JSON.parse(
    execFileSync(
      process.execPath,
      [require.resolve("@sentry/cli/bin/sentry-cli"), "debug-files", "check", "--json", path],
      {
        encoding: "utf8",
        maxBuffer: 8 * 1024 ** 2
      }
    )
  ) as PluginDebugInfo
}

function arch(value: string): string {
  if (value === "x86_64" || value === "amd64") return "x64"
  if (value === "aarch64") return "arm64"
  return value
}

function matchingVariant(info: PluginDebugInfo, expectedArch: string, debugId: string): boolean {
  return (
    Array.isArray(info.variants) &&
    info.variants.filter(
      (variant) =>
        arch(variant.arch) === expectedArch &&
        variant.debug_id.toLowerCase() === debugId.toLowerCase()
    ).length === 1
  )
}

// Hashes pin bytes; this verifies that every shipped plug-in slice has usable
// debug information for the same module, independent of release metadata.
export async function validatePluginSymbols(
  runtimeDirectory: string,
  symbolsDirectory: string,
  release: PluginRelease,
  platform: PluginPlatform,
  inspect: PluginDebugInspector = inspectPluginDebugInfo
): Promise<void> {
  const runtime = parseBundleManifest(
    JSON.parse(await readFile(join(runtimeDirectory, "bundle-manifest.json"), "utf8")),
    release,
    platform
  )
  const symbols = parseSymbolsManifest(
    JSON.parse(await readFile(join(symbolsDirectory, "symbols-manifest.json"), "utf8")),
    release,
    platform
  )
  const arches =
    platform === "macos-universal"
      ? ["x64", "arm64"]
      : [platform.endsWith("arm64") ? "arm64" : "x64"]
  const expected = new Set(
    runtime.plugins.flatMap((plugin) =>
      arches.map((arch) => `${pluginBinaryPath(plugin.bundleName, platform)}:${arch}`)
    )
  )
  if (symbols.modules.length !== expected.size)
    throw new Error("Plug-in symbols must cover every runtime plug-in and architecture")
  const inspected = new Map<string, Promise<PluginDebugInfo>>()
  const info = (path: string): Promise<PluginDebugInfo> => {
    let result = inspected.get(path)
    if (!result) {
      result = Promise.resolve(inspect(path))
      inspected.set(path, result)
    }
    return result
  }
  for (const module of symbols.modules) {
    const key = `${module.binaryPath}:${module.arch}`
    if (!expected.delete(key))
      throw new Error("Plug-in symbols contain a duplicate or unlisted runtime module")
    const binary = await info(join(runtimeDirectory, module.binaryPath))
    const debug = await info(join(symbolsDirectory, module.modulePath))
    if (
      !matchingVariant(binary, module.arch, module.debugId) ||
      !matchingVariant(debug, module.arch, module.debugId)
    )
      throw new Error("Plug-in symbols Debug ID or architecture does not match its runtime binary")
    if (debug.is_usable !== true || !debug.features.split(/\s*,\s*/u).includes("debug"))
      throw new Error("Plug-in symbols lack usable full debug information")
  }
}
