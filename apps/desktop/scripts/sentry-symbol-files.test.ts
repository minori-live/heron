import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { stageSentrySymbols } from "./sentry-symbol-files.ts"

await test("retains both macOS architectures, Windows PDB and Linux addon symbols alongside matching maps", async () => {
  const root = await mkdtemp(join(tmpdir(), "heron-symbol-files-"))
  const target = join(root, "target")
  const output = join(root, "symbols")
  const main = join(root, "main")
  async function file(path: string, data: string) {
    await mkdir(join(path, ".."), { recursive: true })
    await writeFile(path, data)
  }
  try {
    await file(join(main, "index.js"), "debugId: matching")
    await file(join(main, "index.js.map"), "source map: matching")
    for (const architecture of ["aarch64-apple-darwin", "x86_64-apple-darwin"]) {
      const profile = join(target, architecture, "release")
      await file(join(profile, "libheron_dsp_node.dylib"), architecture)
      await file(
        join(
          profile,
          "libheron_dsp_node.dylib.dSYM/Contents/Resources/DWARF/libheron_dsp_node.dylib"
        ),
        `symbols: ${architecture}`
      )
      await file(join(profile, "libheron_dsp_node.rlib"), "intermediate")
    }
    await file(join(target, "release/libheron_dsp_node.so"), "linux symbols")
    await file(join(target, "x86_64-pc-windows-msvc/release/heron_dsp_node.dll"), "windows addon")
    await file(join(target, "x86_64-pc-windows-msvc/release/heron_dsp_node.pdb"), "windows symbols")
    const plugins = join(root, "plugin-symbols")
    await file(join(plugins, "symbols/linux-x64/Heron Gain.so"), "matching plug-in symbols")
    await file(join(plugins, "symbols-manifest.json"), "pinned plug-in source and debug IDs")
    await stageSentrySymbols(target, main, output, plugins)
    assert.equal(await readFile(join(output, "main/index.js.map"), "utf8"), "source map: matching")
    assert.equal(
      await readFile(join(output, "native/host/libheron_dsp_node.so"), "utf8"),
      "linux symbols"
    )
    assert.equal(
      await readFile(join(output, "native/x86_64-pc-windows-msvc/heron_dsp_node.pdb"), "utf8"),
      "windows symbols"
    )
    assert.equal(
      await readFile(join(output, "native/heron-plugins/linux-x64/Heron Gain.so"), "utf8"),
      "matching plug-in symbols"
    )
    assert.equal(
      await readFile(join(output, "heron-plugins-symbols-manifest.json"), "utf8"),
      "pinned plug-in source and debug IDs"
    )
    for (const architecture of ["aarch64-apple-darwin", "x86_64-apple-darwin"]) {
      const profile = join(output, "native", architecture)
      assert.equal(
        await readFile(
          join(
            profile,
            "libheron_dsp_node.dylib.dSYM/Contents/Resources/DWARF/libheron_dsp_node.dylib"
          ),
          "utf8"
        ),
        `symbols: ${architecture}`
      )
      assert(!(await readdir(profile)).includes("libheron_dsp_node.rlib"))
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

await test("fails the symbol staging step when a release addon is missing its companion debug file", async () => {
  const root = await mkdtemp(join(tmpdir(), "heron-missing-symbols-"))
  try {
    await mkdir(join(root, "target/release"), { recursive: true })
    await mkdir(join(root, "main"))
    await writeFile(join(root, "target/release/libheron_dsp_node.dylib"), "addon")
    await assert.rejects(
      stageSentrySymbols(join(root, "target"), join(root, "main"), join(root, "symbols")),
      /Missing addon dSYM/
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
