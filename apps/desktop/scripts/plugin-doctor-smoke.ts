import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import { decode, encode } from "@msgpack/msgpack"
import { AudioHostRuntime } from "@heron/dsp-node"
import type { DoctorJobStatus } from "../src/main/audio-host/wire/generated/DoctorJobStatus.ts"
import type { ControlResponse } from "../src/main/audio-host/wire/rpc.ts"

// This protects Heron's N-API/MessagePack measurement ownership and report mapping.
// Optional official gain fixtures exercise the VST3 and CLAP processing boundary.
const [vst3Path, vst3Id, clapPath] = process.argv.slice(2)
const fixtures = [
  { name: "passthrough", format: null, path: null, nativeId: null },
  ...(vst3Path ? [{ name: "VST3", format: "vst3", path: vst3Path, nativeId: vst3Id }] : []),
  ...(clapPath
    ? [
        {
          name: "CLAP",
          format: "clap",
          path: clapPath,
          nativeId: "com.github.free-audio.clap.gain"
        }
      ]
    : [])
]
const runtime = new AudioHostRuntime(2, 4)
const uiPump = setInterval(() => runtime.drainUiWork(), 8)
let requestId = 0

async function send(command: Record<string, unknown>): Promise<ControlResponse["result"]> {
  const request_id = ++requestId
  const response = await runtime.request(Buffer.from(encode({ request_id, command })))
  const decoded = decode(response.body) as ControlResponse
  assert.equal(decoded.request_id, request_id)
  assert.notEqual(decoded.result.type, "error", JSON.stringify(decoded.result.error))
  return decoded.result
}

async function status(command: Record<string, unknown>): Promise<DoctorJobStatus> {
  const result = await send(command)
  assert.equal(result.type, "plugin-doctor")
  assert.ok(result.doctor_status)
  return result.doctor_status
}

try {
  for (const fixture of fixtures) {
    const instanceId = `doctor-measure-${randomUUID()}`
    if (fixture.format) {
      assert.ok(fixture.nativeId)
      const loaded = await send({
        type: "load-plugin",
        instance_id: instanceId,
        locator: {
          format: fixture.format,
          artifact_path: fixture.path,
          native_id: fixture.nativeId
        },
        plugin_kind: "effect",
        audio_mode: "stereo",
        active_aux_inputs: [],
        sample_rate: 48000,
        state: { version: 1, chunks: [] }
      })
      assert.equal(loaded.type, "plugin-loaded")
    }
    const operation_id = randomUUID()
    const start = {
      type: "start-plugin-doctor",
      operation_id,
      instance_ids: fixture.format ? [instanceId] : [],
      settings: {
        sample_rate: 48000,
        block_size: 256,
        level_dbfs: 6,
        start_hz: 20,
        end_hz: 20000,
        sweep_seconds: 1,
        tail_seconds: 0.25
      },
      reported_latency_samples: 0
    }
    let current = await status(start)
    assert.equal(current.state, "running")
    assert.equal((await status(start)).state, "running", "start must be idempotent")
    const deadline = Date.now() + 60000
    while (current.state === "running" && Date.now() < deadline) {
      await delay(50)
      current = await status({ type: "plugin-doctor-status", operation_id })
    }
    assert.equal(current.state, "completed", JSON.stringify(current))
    if (current.state !== "completed") throw new Error("Measurement did not complete")
    const report = current.report
    assert.equal(report.settings.level_dbfs, 6)
    assert.equal(report.responses.length, 4)
    assert.equal(report.harmonics.length, 2)
    assert.equal(report.models.length, 2)
    assert.ok(report.performance.measured_blocks > 0)
    for (const response of report.responses.filter((path) => path.input === path.output)) {
      assert.equal(response.delay_samples, 0)
      assert.ok(response.magnitude_db.every(Number.isFinite))
      assert.ok(response.repeat_error_percent < 0.01)
      if (!fixture.format) assert.ok(response.magnitude_db.every((db) => Math.abs(db) < 0.01))
    }
    for (const model of report.models) {
      assert.ok(model.suitable)
      assert.ok(model.validation_error_percent < 2)
    }
    assert.equal((await status({ type: "release-plugin-doctor", operation_id })).state, "completed")
    assert.deepEqual(await status({ type: "plugin-doctor-status", operation_id }), {
      state: "failed",
      failure: "missing-job"
    })
    if (fixture.format) await send({ type: "unload-plugin", instance_id: instanceId, force: true })
    console.log(`Plugin Doctor ${fixture.name} passed (+6 dBFS, report and endpoint release)`)
  }
  const operation_id = randomUUID()
  await status({
    type: "start-plugin-doctor",
    operation_id,
    instance_ids: [],
    settings: {
      sample_rate: 48000,
      block_size: 256,
      level_dbfs: 12,
      start_hz: 20,
      end_hz: 20000,
      sweep_seconds: 1,
      tail_seconds: 0.25
    },
    reported_latency_samples: 0
  })
  await status({ type: "cancel-plugin-doctor", operation_id })
  const deadline = Date.now() + 10000
  let cancelled = await status({ type: "plugin-doctor-status", operation_id })
  while (cancelled.state === "running" && Date.now() < deadline) {
    await delay(20)
    cancelled = await status({ type: "plugin-doctor-status", operation_id })
  }
  assert.deepEqual(cancelled, { state: "failed", failure: "cancelled" })
  await status({ type: "release-plugin-doctor", operation_id })
  console.log("Plugin Doctor +12 dBFS admission and cancellation passed")
} finally {
  clearInterval(uiPump)
  runtime.close()
}
