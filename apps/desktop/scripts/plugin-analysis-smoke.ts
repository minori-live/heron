import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import { decode, encode } from "@msgpack/msgpack"
import { AudioHostRuntime } from "@heron/dsp-node"
import type { PluginAnalysisJobStatus } from "../src/main/audio-host/wire/generated/PluginAnalysisJobStatus.ts"
import type { ControlResponse } from "../src/main/audio-host/wire/rpc.ts"

// This protects Heron's N-API/MessagePack measurement ownership and report mapping.
// Optional plug-ins exercise the lab-state clone, parameter replay, and processing boundary.
const [vst3Path, vst3Id, clapPath] = process.argv.slice(2)
const fixtures = [
  { name: "passthrough", format: null, path: null, nativeId: null, gainFixture: true },
  ...(vst3Path
    ? [
        {
          name: "VST3",
          format: "vst3",
          path: vst3Path,
          nativeId: vst3Id,
          gainFixture: vst3Id === "41347FD6FED64094AFBB12B7DBA1D441"
        }
      ]
    : []),
  ...(clapPath
    ? [
        {
          name: "CLAP",
          format: "clap",
          path: clapPath,
          nativeId: "com.github.free-audio.clap.gain",
          gainFixture: true
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

async function status(command: Record<string, unknown>): Promise<PluginAnalysisJobStatus> {
  const result = await send(command)
  assert.equal(result.type, "plugin-analysis")
  assert.ok(result.plugin_analysis_status)
  return result.plugin_analysis_status
}

try {
  for (const fixture of fixtures) {
    const originalId = `plugin-analysis-lab-${randomUUID()}`
    const instanceId = `plugin-analysis-measure-${randomUUID()}`
    let latencySamples = 0
    if (fixture.format) {
      assert.ok(fixture.nativeId)
      const load = {
        type: "load-plugin",
        locator: {
          format: fixture.format,
          artifact_path: fixture.path,
          native_id: fixture.nativeId
        },
        plugin_kind: "effect",
        audio_mode: "stereo",
        active_aux_inputs: [],
        sample_rate: 48000
      }
      const original = await send({
        ...load,
        instance_id: originalId,
        state: { version: 1, chunks: [] }
      })
      assert.equal(original.type, "plugin-loaded")
      const saved = await send({ type: "save-plugin-state", instance_id: originalId })
      assert.equal(saved.type, "plugin-state")
      assert.ok(saved.state && "chunks" in saved.state)
      const listed = await send({ type: "plugin-parameters", instance_id: originalId })
      assert.equal(listed.type, "plugin-parameters")
      assert.ok(listed.parameters)
      const loaded = await send({ ...load, instance_id: instanceId, state: saved.state })
      assert.equal(loaded.type, "plugin-loaded")
      assert.notEqual(loaded.runtime_handle, original.runtime_handle)
      latencySamples = loaded.latency_samples ?? 0
      // Match PluginAnalysisService: controller edits can precede a DSP block, so
      // state restoration is followed by replay of authoritative editable values.
      for (const parameter of listed.parameters.filter((p) => !p.read_only && !p.hidden)) {
        await send({
          type: "set-plugin-parameter",
          instance_id: instanceId,
          parameter_key: parameter.parameter_key,
          value: parameter.value,
          gesture: "end"
        })
      }
    }
    const operation_id = randomUUID()
    const start = {
      type: "start-plugin-analysis",
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
      reported_latency_samples: latencySamples
    }
    let current = await status(start)
    assert.equal(current.state, "running")
    assert.equal((await status(start)).state, "running", "start must be idempotent")
    const deadline = Date.now() + 60000
    while (current.state === "running" && Date.now() < deadline) {
      await delay(50)
      current = await status({ type: "plugin-analysis-status", operation_id })
    }
    assert.equal(current.state, "completed", JSON.stringify(current))
    if (current.state !== "completed") throw new Error("Measurement did not complete")
    const report = current.report
    assert.equal(report.settings.level_dbfs, 6)
    assert.equal(report.responses.length, 4)
    assert.equal(report.harmonics.length, 2)
    assert.equal(report.models.length, 2)
    assert.ok(report.performance.measured_blocks > 0)
    assert.equal(report.performance.reported_latency_samples, latencySamples)
    for (const response of report.responses) {
      assert.ok(response.magnitude_db.every(Number.isFinite))
    }
    if (fixture.gainFixture) {
      for (const response of report.responses.filter((path) => path.input === path.output)) {
        assert.equal(response.delay_samples, 0)
        assert.ok(response.repeat_error_percent < 0.01)
        if (!fixture.format) assert.ok(response.magnitude_db.every((db) => Math.abs(db) < 0.01))
      }
      for (const model of report.models) {
        assert.ok(model.suitable)
        assert.ok(model.validation_error_percent < 2)
      }
    }
    assert.equal(
      (await status({ type: "release-plugin-analysis", operation_id })).state,
      "completed"
    )
    assert.deepEqual(await status({ type: "plugin-analysis-status", operation_id }), {
      state: "failed",
      failure: "missing-job"
    })
    if (fixture.format) {
      await send({ type: "unload-plugin", instance_id: instanceId, force: true })
      await send({ type: "unload-plugin", instance_id: originalId, force: true })
    }
    console.log(`Plugin Analysis ${fixture.name} passed (+6 dBFS, report and endpoint release)`)
  }
  const operation_id = randomUUID()
  await status({
    type: "start-plugin-analysis",
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
  await status({ type: "cancel-plugin-analysis", operation_id })
  const deadline = Date.now() + 10000
  let cancelled = await status({ type: "plugin-analysis-status", operation_id })
  while (cancelled.state === "running" && Date.now() < deadline) {
    await delay(20)
    cancelled = await status({ type: "plugin-analysis-status", operation_id })
  }
  assert.deepEqual(cancelled, { state: "failed", failure: "cancelled" })
  await status({ type: "release-plugin-analysis", operation_id })
  console.log("Plugin Analysis +12 dBFS admission and cancellation passed")
} finally {
  clearInterval(uiPump)
  runtime.close()
}
