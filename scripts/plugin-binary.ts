import type { PluginPlatform } from "./plugin-artifact-contract.ts"

function expectedMachine(platform: PluginPlatform): number {
  return platform.endsWith("arm64") ? 183 : 62
}

export function validateArtifactBinary(
  bytes: Buffer,
  platform: PluginPlatform,
  kind: "plugin" | "library"
): void {
  if (bytes.length < 64) throw new Error("Truncated plug-in binary")
  if (platform.startsWith("linux")) {
    if (
      !bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
      bytes[4] !== 2 ||
      bytes[5] !== 1 ||
      bytes.readUInt16LE(18) !== expectedMachine(platform)
    )
      throw new Error("Plug-in ELF architecture does not match its platform")
    return
  }
  if (platform === "windows-x64") {
    const pe = bytes.readUInt32LE(0x3c)
    if (
      bytes.readUInt16LE(0) !== 0x5a4d ||
      pe > bytes.length - 6 ||
      bytes.readUInt32LE(pe) !== 0x4550 ||
      bytes.readUInt16LE(pe + 4) !== 0x8664
    )
      throw new Error("Plug-in PE architecture does not match its platform")
    return
  }
  const magic = bytes.readUInt32BE(0)
  const fat64 = magic === 0xcafebabf
  if (magic !== 0xcafebabe && !fat64) throw new Error("macOS plug-in must be a universal Mach-O")
  const slices = bytes.readUInt32BE(4)
  const size = fat64 ? 32 : 20
  if (slices !== 2 || bytes.length < 8 + slices * size)
    throw new Error("Invalid universal plug-in slices")
  const cpus = new Set<number>()
  for (let index = 0; index < slices; index += 1) {
    const entry = 8 + index * size
    cpus.add(bytes.readUInt32BE(entry))
    const offset = fat64 ? Number(bytes.readBigUInt64BE(entry + 8)) : bytes.readUInt32BE(entry + 8)
    const length = fat64
      ? Number(bytes.readBigUInt64BE(entry + 16))
      : bytes.readUInt32BE(entry + 12)
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      length < 16 ||
      offset < 8 + slices * size ||
      offset > bytes.length - length ||
      bytes.readUInt32LE(offset) !== 0xfeedfacf ||
      bytes.readUInt32LE(offset + 4) !== bytes.readUInt32BE(entry) ||
      bytes.readUInt32LE(offset + 12) !== (kind === "plugin" ? 8 : 6)
    )
      throw new Error("Invalid universal plug-in binary slice")
  }
  if (!cpus.has(0x01000007) || !cpus.has(0x0100000c))
    throw new Error("Universal plug-in requires x64 and arm64 slices")
}
