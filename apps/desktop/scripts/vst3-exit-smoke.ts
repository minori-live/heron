import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"

const [pluginPath, nativeId, cycles = "3", runsArgument = "3"] = process.argv.slice(2)
const runs = Number(runsArgument)
assert(pluginPath && nativeId, "Usage: vst3-exit-smoke.ts <VST3 path> <native ID> [cycles] [runs]")
assert(
  Number.isInteger(Number(cycles)) && Number(cycles) >= 1 && Number(cycles) <= 100,
  "Expected 1–100 cycles"
)
assert(Number.isInteger(runs) && runs >= 1 && runs <= 100, "Expected 1–100 process runs")
const electron: unknown = createRequire(import.meta.url)("electron")
assert.equal(typeof electron, "string")
const fixture = await mkdtemp(join(tmpdir(), "heron-vst3-exit-"))
try {
  await writeFile(join(fixture, "package.json"), JSON.stringify({ main: "main.mjs" }))
  // Generated bootstrap; hand-authored smoke logic stays in erasable TypeScript.
  await writeFile(
    join(fixture, "main.mjs"),
    `await import(${JSON.stringify(new URL("./vst3-exit-smoke-main.ts", import.meta.url).href)});\n`
  )
  for (let run = 0; run < runs; run++) {
    const child = spawn(electron as string, [fixture, pluginPath, nativeId, cycles], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
      stdio: ["ignore", "pipe", "inherit"]
    })
    let output = ""
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString()
      process.stdout.write(chunk)
    })
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          child.kill("SIGKILL")
          reject(new Error(`VST3 exit smoke run ${run + 1} timed out`))
        },
        Math.max(60_000, Number(cycles) * 20_000)
      )
      child.once("error", (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      child.once("exit", (code, signal) => {
        clearTimeout(timeout)
        if (code === 0 && !signal && output.includes("VST3 exit smoke: all cycles completed"))
          resolve()
        else reject(new Error(`VST3 exit smoke run ${run + 1}: code ${code}, signal ${signal}`))
      })
    })
    console.log(`VST3 exit smoke: process ${run + 1}/${runs} exited cleanly`)
  }
} finally {
  await rm(fixture, { recursive: true, force: true })
}
