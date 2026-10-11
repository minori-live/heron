import { copyFile, readFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { Arch, type AfterPackContext } from "electron-builder"

export default async function restorePluginPlists(context: AfterPackContext): Promise<void> {
  if (context.electronPlatformName !== "darwin" || context.arch !== Arch.universal) return

  const bundles = resolve(import.meta.dirname, "../../../target/bundles")
  const manifest = JSON.parse(await readFile(join(bundles, "bundle-manifest.json"), "utf8")) as {
    plugins: { bundleName: string }[]
  }
  const plugins = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    "Contents/Resources/plugins"
  )
  // Universal merging changes these signed resources even when the Mach-O is
  // already universal. Restore the verified producer bytes before app signing.
  for (const { bundleName } of manifest.plugins) {
    const plist = join(bundleName, "Contents/Info.plist")
    await copyFile(join(bundles, plist), join(plugins, plist))
  }
}
