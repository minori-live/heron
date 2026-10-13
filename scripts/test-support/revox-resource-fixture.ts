import type { PluginPlatform } from "../plugin-artifact-contract.ts"

// Minimal resources for consumer policy tests. These are deliberately not usable
// inference models or an upstream distribution inventory.
export function revoxResourceFixture(platform: PluginPlatform): { path: string; bytes: Buffer }[] {
  const paths = {
    "windows-x64": "Contents/x86_64-win/onnxruntime.dll",
    "linux-x64": "Contents/x86_64-linux/libonnxruntime.so",
    "linux-arm64": "Contents/aarch64-linux/libonnxruntime.so",
    "macos-universal": "Contents/Frameworks/libonnxruntime.dylib"
  }
  const runtime = Buffer.alloc(128)
  if (platform.startsWith("linux")) {
    runtime.set([0x7f, 0x45, 0x4c, 0x46, 2, 1])
    runtime.writeUInt16LE(platform === "linux-arm64" ? 183 : 62, 18)
  } else if (platform === "windows-x64") {
    runtime.writeUInt16LE(0x5a4d)
    runtime.writeUInt32LE(64, 0x3c)
    runtime.writeUInt32LE(0x4550, 64)
    runtime.writeUInt16LE(0x8664, 68)
  } else {
    runtime.writeUInt32BE(0xcafebabe)
    runtime.writeUInt32BE(2, 4)
    for (const [index, cpu] of [0x01000007, 0x0100000c].entries()) {
      const entry = 8 + index * 20
      const offset = 64 + index * 32
      runtime.writeUInt32BE(cpu, entry)
      runtime.writeUInt32BE(offset, entry + 8)
      runtime.writeUInt32BE(32, entry + 12)
      runtime.writeUInt32LE(0xfeedfacf, offset)
      runtime.writeUInt32LE(cpu, offset + 4)
      runtime.writeUInt32LE(6, offset + 12)
    }
  }
  const digest = "a".repeat(64)
  const revision = "b".repeat(40)
  const model = { onnx: { file: "embedded.onnx", sha256: digest } }
  const notices = [
    "FCPE-LICENSE",
    "revox-README.md",
    "onnxruntime-LICENSE",
    "onnxruntime-ThirdPartyNotices.txt",
    "dawn-LICENSE"
  ]
  const metadata: Record<string, unknown> = {
    "runtime-source.json": {
      version: "1.0.0",
      repository: "https://example.invalid/runtime",
      sourceCommit: revision,
      platform,
      bundlePath: paths[platform]
    },
    "fcpe-source.json": {
      repository: "https://example.invalid/fcpe",
      revision,
      license: "MIT"
    },
    "fcpe-plugin-export.json": model,
    "revox-manifest.json": model,
    "revox-plugin-manifest.json": { ...model, revision, source_sha256: digest },
    "license-selection.json": {
      selectedLicense: "GPL-3.0-only",
      revision,
      source: "https://example.invalid/revox/README.md",
      readmeSha256: digest
    },
    "sources.json": {
      files: ["onnxruntime-LICENSE", "onnxruntime-ThirdPartyNotices.txt", "dawn-LICENSE"].map(
        (file) => ({ file, source: `https://example.invalid/${file}`, sha256: digest })
      )
    }
  }
  const base = "Contents/Resources/licenses/revox-models-and-runtime"
  return [
    { path: paths[platform], bytes: runtime },
    ...notices.map((name) => ({ path: `${base}/${name}`, bytes: Buffer.from("License fixture") })),
    ...Object.entries(metadata).map(([name, value]) => ({
      path: `${base}/${name}`,
      bytes: Buffer.from(JSON.stringify(value))
    }))
  ]
}
