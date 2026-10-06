import { app } from "electron"
import { AudioHostRuntime } from "@heron/dsp-node"
import { decode, encode } from "@msgpack/msgpack"

const [pluginPath, nativeId, cyclesArgument = "3"] = process.argv.slice(-3)
const cycles = Number(cyclesArgument)
if (!pluginPath || !nativeId || !Number.isInteger(cycles) || cycles < 1 || cycles > 100) {
  throw new Error("Expected VST3 path, native ID and 1–100 cycles")
}

async function run(): Promise<void> {
  let requestId = 0
  for (let cycle = 0; cycle < cycles; cycle++) {
    const runtime = new AudioHostRuntime(2, 4)
    const uiPump = setInterval(() => runtime.drainUiWork(), 8)
    async function send(command: unknown, expected: string): Promise<void> {
      const id = ++requestId
      const response = await runtime.request(Buffer.from(encode({ request_id: id, command })))
      const decoded = decode(response.body) as {
        request_id: number
        result: { type: string; parameters?: unknown[] }
      }
      if (decoded.request_id !== id || decoded.result.type !== expected) {
        throw new Error(`Unexpected ${expected} response: ${JSON.stringify(decoded)}`)
      }
      if (expected === "plugin-parameters") {
        if (!decoded.result.parameters?.length) throw new Error("Plug-in exposed no parameters")
        console.log(`Cycle ${cycle + 1}: ${decoded.result.parameters.length} parameters`)
      }
    }
    try {
      await send(
        {
          type: "load-plugin",
          instance_id: "exit-smoke",
          locator: { format: "vst3", artifact_path: pluginPath, native_id: nativeId },
          plugin_kind: "effect",
          audio_mode: "stereo",
          sample_rate: 48_000,
          state: { version: 1, chunks: [] }
        },
        "plugin-loaded"
      )
      await send({ type: "plugin-parameters", instance_id: "exit-smoke" }, "plugin-parameters")
      await send({ type: "unload-plugin", instance_id: "exit-smoke" }, "accepted")
    } finally {
      clearInterval(uiPump)
      runtime.close()
      // Close stops the audio/control runtime asynchronously. Keep Electron's
      // main loop alive before quitting, matching the issue #209 reproduction.
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  console.log("VST3 exit smoke: all cycles completed; quitting Electron")
  app.quit()
}

void app
  .whenReady()
  .then(run)
  .catch((error: unknown) => {
    console.error(error)
    app.exit(1)
  })
