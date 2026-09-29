import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { findEngineSerializationDependencies, findNativeMirrors } from "./native-mirror-policy.ts"

await test("the engine declares no Native-prefixed models", () => {
  assert.deepEqual(findNativeMirrors(), [])
})

await test("the engine depends on no serialization crate", () => {
  assert.deepEqual(findEngineSerializationDependencies(), [])
})

await test("detects a re-introduced engine mirror", () => {
  const root = mkdtempSync(join(tmpdir(), "heron-native-mirror-"))
  try {
    mkdirSync(join(root, "engine"))
    writeFileSync(
      join(root, "engine", "spec.rs"),
      ["pub struct NativeMixerGraph {", "    pub sample_rate: u32,", "}", ""].join("\n")
    )
    assert.deepEqual(findNativeMirrors(root), [
      { path: join(root, "engine", "spec.rs"), line: 1, declaration: "NativeMixerGraph" }
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

await test("allows a non-native domain name beside a Native-prefixed one", () => {
  const root = mkdtempSync(join(tmpdir(), "heron-native-ok-"))
  try {
    writeFileSync(
      join(root, "spec.rs"),
      ["pub struct ResolvedMixerGraph {", "    pub sample_rate: u32,", "}", ""].join("\n")
    )
    assert.deepEqual(findNativeMirrors(root), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

await test("detects a serialization crate in the engine's dependencies", () => {
  const root = mkdtempSync(join(tmpdir(), "heron-native-serde-"))
  try {
    const manifest = join(root, "Cargo.toml")
    writeFileSync(
      manifest,
      [
        "[dependencies]",
        "serde.workspace = true",
        "",
        "[dev-dependencies]",
        "rmp-serde.workspace = true",
        ""
      ].join("\n")
    )
    assert.deepEqual(findEngineSerializationDependencies(manifest), ["serde.workspace = true"])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
