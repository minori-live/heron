import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { PluginPlatform } from "./plugin-artifact-contract.ts"
import { validateArtifactBinary } from "./plugin-binary.ts"

const runtimePaths: Record<PluginPlatform, string> = {
  "windows-x64": "Contents/x86_64-win/onnxruntime.dll",
  "linux-x64": "Contents/x86_64-linux/libonnxruntime.so",
  "linux-arm64": "Contents/aarch64-linux/libonnxruntime.so",
  "macos-universal": "Contents/Frameworks/libonnxruntime.dylib"
}
const noticesPath = "Contents/Resources/licenses/revox-models-and-runtime"
const requiredNotices = [
  "FCPE-LICENSE",
  "revox-README.md",
  "onnxruntime-LICENSE",
  "onnxruntime-ThirdPartyNotices.txt",
  "dawn-LICENSE"
] as const

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a Revox provenance object")
  return value as Record<string, unknown>
}

function text(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0
}

function digest(value: unknown): boolean {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
}

async function provenance(directory: string, name: string): Promise<Record<string, unknown>> {
  return record(JSON.parse(await readFile(join(directory, name), "utf8")))
}

function modelExport(value: Record<string, unknown>): void {
  const onnx = record(value.onnx)
  if (!text(onnx.file) || !digest(onnx.sha256))
    throw new Error("Missing Revox embedded model provenance")
}

// This checks the resources Heron must redistribute, not model inference. The
// model graphs are embedded in the plug-in binary; no external .onnx is required.
// Accept additional upstream metadata and notices without freezing its inventory.
export async function validateRevoxResources(
  bundleDirectory: string,
  platform: PluginPlatform
): Promise<void> {
  const runtimePath = runtimePaths[platform]
  validateArtifactBinary(await readFile(join(bundleDirectory, runtimePath)), platform, "library")
  const directory = join(bundleDirectory, noticesPath)
  for (const name of requiredNotices) {
    if (!(await readFile(join(directory, name), "utf8")).trim())
      throw new Error(`Empty Revox license or notice: ${name}`)
  }

  const runtime = await provenance(directory, "runtime-source.json")
  if (
    runtime.platform !== platform ||
    runtime.bundlePath !== runtimePath ||
    !text(runtime.version) ||
    !text(runtime.repository) ||
    !text(runtime.sourceCommit)
  )
    throw new Error("Revox runtime provenance does not match the bundled runtime")
  // macOS signing changes the library bytes after the producer records its
  // pre-signing digest. The enclosing release archive owns byte integrity.

  const fcpe = await provenance(directory, "fcpe-source.json")
  if (!text(fcpe.repository) || !text(fcpe.revision) || !text(fcpe.license))
    throw new Error("Missing FCPE model source and license provenance")
  modelExport(await provenance(directory, "fcpe-plugin-export.json"))
  modelExport(await provenance(directory, "revox-manifest.json"))
  const revox = await provenance(directory, "revox-plugin-manifest.json")
  modelExport(revox)
  if (!text(revox.revision) || !digest(revox.source_sha256))
    throw new Error("Missing Revox model source provenance")

  const selection = await provenance(directory, "license-selection.json")
  if (
    selection.selectedLicense !== "GPL-3.0-only" ||
    selection.revision !== revox.revision ||
    !text(selection.source) ||
    !digest(selection.readmeSha256)
  )
    throw new Error("Missing Revox model license selection and source evidence")

  const sources = await provenance(directory, "sources.json")
  if (!Array.isArray(sources.files)) throw new Error("Missing Revox runtime notice sources")
  const files = sources.files.map(record)
  for (const name of ["onnxruntime-LICENSE", "onnxruntime-ThirdPartyNotices.txt", "dawn-LICENSE"]) {
    if (!files.some((file) => file.file === name && text(file.source) && digest(file.sha256)))
      throw new Error(`Missing Revox runtime notice provenance: ${name}`)
  }
}
