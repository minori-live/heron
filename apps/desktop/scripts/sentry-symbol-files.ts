import { cp, mkdir, readdir, rm } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

async function entries(path: string) {
  try {
    return await readdir(path, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
}

export async function stageSentrySymbols(
  target: string,
  mainBundle: string,
  destination: string
): Promise<void> {
  await rm(destination, { recursive: true, force: true })
  await mkdir(destination, { recursive: true })
  await cp(mainBundle, join(destination, "main"), { recursive: true })
  const profiles = [join(target, "release")]
  for (const entry of await entries(target)) {
    if (entry.isDirectory() && /-(?:darwin|msvc|gnu)$/.test(entry.name)) {
      profiles.push(join(target, entry.name, "release"))
    }
  }
  let addonFound = false
  for (const profile of profiles) {
    const files = await entries(profile)
    for (const entry of files) {
      if (
        !/^(?:lib)?heron[-_]/.test(entry.name) ||
        /\.(?:rlib|rmeta|d|a|exp|lib)$/.test(entry.name)
      )
        continue
      if (/^(?:lib)?heron_dsp_node\.(?:dylib|so|dll)$/.test(entry.name)) {
        addonFound = true
        if (
          entry.name.endsWith(".dylib") &&
          !files.some((file) => file.name === `${entry.name}.dSYM`)
        ) {
          throw new Error(`Missing addon dSYM in ${profile}; use packed release debug information`)
        }
        if (
          entry.name.endsWith(".dll") &&
          !files.some((file) => file.name === "heron_dsp_node.pdb")
        ) {
          throw new Error(`Missing addon PDB in ${profile}`)
        }
      }
      const architecture = profile === profiles[0] ? "host" : basename(dirname(profile))
      const output = join(destination, "native", architecture)
      await mkdir(output, { recursive: true })
      await cp(join(profile, entry.name), join(output, entry.name), { recursive: true })
    }
  }
  if (!addonFound) throw new Error("No Heron native addon found in the release build")
}
