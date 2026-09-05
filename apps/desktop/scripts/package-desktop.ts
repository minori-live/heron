import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { releaseBuild } from "../src/shared/release-build.ts"

const require = createRequire(import.meta.url)
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
) as { version: string }
const release = releaseBuild(version, process.env)
// GitHub publish configuration does not infer the metadata channel in builder 26.
const channel = release?.channel ?? version.split("-")[1]?.split(".")[0] ?? "latest"
const result = spawnSync(
  process.execPath,
  [
    require.resolve("electron-builder/cli.js"),
    ...process.argv.slice(2),
    "--publish",
    "never",
    `--config.publish.channel=${channel}`
  ],
  {
    stdio: "inherit",
    cwd: new URL("..", import.meta.url),
    env: process.env
  }
)
if (result.error) throw result.error
process.exitCode = result.status ?? 1
