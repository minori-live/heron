import { parseArgs } from "node:util"
import { resolve } from "node:path"
import { pluginPlatform } from "./plugin-artifact-contract.ts"
import { preparePluginArtifacts } from "./plugin-artifact-cache.ts"

const { values } = parseArgs({
  options: {
    platform: { type: "string" },
    symbols: { type: "boolean", default: false },
    offline: { type: "boolean", default: false }
  }
})
try {
  const destination = await preparePluginArtifacts({
    workspace: resolve(import.meta.dirname, ".."),
    platform: values.platform ? pluginPlatform(values.platform) : undefined,
    symbols: values.symbols,
    offline: values.offline
  })
  console.log(`Verified plug-in artifacts staged in ${destination}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
