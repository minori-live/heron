import { readdirSync, readFileSync } from "node:fs"
import { extname, resolve } from "node:path"

const workspaceRoot = resolve(import.meta.dirname, "..")

/** The runtime-agnostic control-plane crate. */
export const ENGINE_SOURCE_ROOT = resolve(workspaceRoot, "crates/audio-engine/src")
export const ENGINE_MANIFEST = resolve(workspaceRoot, "crates/audio-engine/Cargo.toml")

/** One declaration that re-acquires a boundary name in the engine. */
export interface NativeMirrorViolation {
  path: string
  line: number
  declaration: string
}

function rustFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name)
    if (entry.isDirectory()) return rustFiles(path)
    return extname(entry.name) === ".rs" ? [path] : []
  })
}

/**
 * `Native*` names belong to the napi boundary in `dsp-node`.
 *
 * The engine carried a parallel set of identically shaped `Native*` models
 * joined to the protocol types by hand-written converters. They are gone; a new
 * one would mean the same duplication is returning.
 */
export function findNativeMirrors(root = ENGINE_SOURCE_ROOT): NativeMirrorViolation[] {
  const pattern = /\bpub\s+(?:struct|enum)\s+(Native[A-Z]\w*)/gu
  return rustFiles(root).flatMap((path) => {
    const violations: NativeMirrorViolation[] = []
    readFileSync(path, "utf8")
      .split("\n")
      .forEach((text, index) => {
        for (const match of text.matchAll(pattern)) {
          violations.push({
            path,
            line: index + 1,
            declaration: match[1] ?? match[0]
          })
        }
      })
    return violations
  })
}

/**
 * The engine must stay free of `serde`.
 *
 * Its types are the resolved control-plane form, and the protocol crate owns
 * everything that is encoded or persisted. A serde dependency here would let a
 * second serialised shape appear beside the real one.
 */
export function findEngineSerializationDependencies(manifest = ENGINE_MANIFEST): string[] {
  const text = readFileSync(manifest, "utf8")
  const dependencies = text.split("[dev-dependencies]")[0] ?? text
  return dependencies
    .split("\n")
    .filter((line) => /^(serde|rmp-serde|serde_json|serde_bytes)\b/u.test(line.trim()))
    .map((line) => line.trim())
}
