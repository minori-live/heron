import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { setTimeout } from "node:timers/promises"
import { decode, encode } from "@msgpack/msgpack"
import { AudioHostRuntime } from "@heron/dsp-node"

interface Result {
  type: string
  error?: { code?: string; user_message_key?: string }
  state?: {
    chunks: Array<{ key: string; bytes: { storage: string; bytes?: Uint8Array } }>
  }
}

const workspace = resolve(import.meta.dirname, "../../..")
const fixtures = resolve(workspace, "packages/project-db/src/__tests__/fixtures/legacy-builtins")
const plugins = [
  { slug: "gain", name: "Heron Gain", id: "46774F504DF84B4AC1F308AB88DD3677", kind: "effect" },
  { slug: "sine", name: "Heron Sine", id: "C1351DFA4DDD4B4AC1F30896F6D9DF76", kind: "instrument" },
  {
    slug: "metronome",
    name: "Heron Metronome",
    id: "8CD16A11027ACC7FDF0C1419E86D1024",
    kind: "instrument"
  },
  {
    slug: "eq",
    name: "Heron EQ",
    id: "8A8341D5CA36B6C9A9572788F40EBB9F",
    kind: "effect"
  }
] as const
const runtime = new AudioHostRuntime(2, 4)
const pump = setInterval(() => runtime.drainUiWork(), 8)
pump.unref()
let requestId = 0

async function send(command: unknown): Promise<Result> {
  const id = ++requestId
  const reply = await runtime.request(Buffer.from(encode({ request_id: id, command })))
  const decoded = decode(reply.body) as { request_id: number; result: Result }
  assert.equal(decoded.request_id, id)
  assert.notEqual(decoded.result.type, "error", JSON.stringify(decoded.result.error))
  return decoded.result
}

function statePath(slug: string): string {
  return slug === "eq"
    ? resolve(workspace, "crates/audio-host/tests/fixtures/eq-fit/legacy.pluginstate")
    : resolve(fixtures, `${slug}.pluginstate`)
}

try {
  // Keep all four modules loaded together: each restored state must remain
  // independent of another plug-in's parameters and shared editor implementation.
  for (const plugin of plugins) {
    const component = await readFile(statePath(plugin.slug))
    const loaded = await send({
      type: "load-plugin",
      instance_id: `legacy-${plugin.slug}`,
      locator: {
        format: "vst3",
        artifact_path: resolve(workspace, "target/bundles", `${plugin.name}.vst3`),
        native_id: plugin.id
      },
      plugin_kind: plugin.kind,
      audio_mode: "stereo",
      sample_rate: 48_000,
      state: {
        version: 1,
        chunks: [{ key: "component", bytes: { storage: "inline", bytes: component } }]
      }
    })
    assert.equal(loaded.type, "plugin-loaded")
  }
  for (const plugin of plugins) {
    const saved = await send({ type: "save-plugin-state", instance_id: `legacy-${plugin.slug}` })
    assert.equal(saved.type, "plugin-state")
    const component = saved.state?.chunks.find((chunk) => chunk.key === "component")
    assert.equal(component?.bytes.storage, "inline")
    assert.ok(component.bytes.bytes instanceof Uint8Array)
    assert.deepEqual(
      new Uint8Array(component.bytes.bytes),
      new Uint8Array(await readFile(statePath(plugin.slug))),
      `${plugin.name} did not retain its original nondefault component state`
    )
    await send({ type: "unload-plugin", instance_id: `legacy-${plugin.slug}` })
  }
  console.log("Built-in VST3 historical state restore passed (four independent native modules)")
} finally {
  clearInterval(pump)
  runtime.close()
  await setTimeout(250)
}
