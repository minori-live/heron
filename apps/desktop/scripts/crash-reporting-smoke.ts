import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { createRequire } from "node:module"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { gunzipSync } from "node:zlib"
import { transpileModule, ModuleKind, ScriptTarget } from "typescript"

const require = createRequire(import.meta.url)
const electron: unknown = require("electron")
assert.equal(typeof electron, "string")
const fixture = await mkdtemp(join(tmpdir(), "heron-sentry-smoke-"))
const reports: Buffer[] = []
const server = createServer((request, response) => {
  const chunks: Buffer[] = []
  request.on("data", (chunk: Buffer) => chunks.push(chunk))
  request.on("end", () => {
    const body = Buffer.concat(chunks)
    reports.push(request.headers["content-encoding"] === "gzip" ? gunzipSync(body) : body)
    response.writeHead(200, { "content-type": "application/json" })
    response.end("{}")
  })
})
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
const address = server.address()
assert(address && typeof address !== "string")
const dsn = `http://public@127.0.0.1:${address.port}/1`

async function run(mode: "native" | "relaunch" | "javascript" | "revoke"): Promise<number | null> {
  return new Promise((resolve, reject) => {
    // CI's Electron archive has no root-owned setuid sandbox helper. Match the
    // other Linux Electron fixtures; this flag applies only to this test app.
    const electronArguments = [
      ...(process.platform === "linux" ? ["--ozone-platform=x11", "--no-sandbox"] : []),
      fixture,
      mode
    ]
    const child = spawn(electron as string, electronArguments, {
      cwd: fixture,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
      stdio: ["ignore", "pipe", "pipe"]
    })
    let output = ""
    child.stdout.on("data", (data: Buffer) => {
      output += data.toString()
    })
    child.stderr.on("data", (data: Buffer) => {
      output += data.toString()
    })
    const timeout = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error(`Electron crash smoke timed out (${mode}): ${output}`))
    }, 20_000)
    child.once("error", (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once("exit", (code) => {
      clearTimeout(timeout)
      if (!output.includes("HERON_NATIVE_LOADED")) {
        reject(new Error(`Electron did not load the native addon (${mode}): ${output}`))
      } else {
        resolve(code)
      }
    })
  })
}

try {
  const source = await readFile(
    new URL("../src/main/diagnostics/crash-reporting.ts", import.meta.url),
    "utf8"
  )
  const compiled = transpileModule(source, {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2023 }
  }).outputText
  await writeFile(join(fixture, "crash-reporting.mjs"), compiled)
  await writeFile(
    join(fixture, "package.json"),
    JSON.stringify({ name: "heron-crash-smoke", version: "0.6.3", main: "main.mjs" })
  )
  await writeFile(join(fixture, "settings.json"), JSON.stringify({ diagnosticsEnabled: true }))
  await writeFile(
    join(fixture, "main.mjs"),
    `
import { app } from "electron";
import * as Sentry from ${JSON.stringify(pathToFileURL(require.resolve("@sentry/electron/main")).href)};
import { createRequire } from "node:module";
import { CrashReporting } from "./crash-reporting.mjs";
app.setName("Heron Crash Smoke");
app.setPath("userData", ${JSON.stringify(fixture)});
const reporting = new CrashReporting({ ...Sentry, init(options) {
  Sentry.init({ ...options, dsn: ${JSON.stringify(dsn)}, onFatalError: () => app.exit(1) });
}});
reporting.initialize({ isPackaged: true, getPath: name => app.getPath(name),
  setPath: (name, value) => app.setPath(name, value), getVersion: () => app.getVersion(),
  whenReady: () => app.whenReady() }, {});
const native = createRequire(import.meta.url)(${JSON.stringify(require.resolve("@heron/dsp-node"))});
if (!native.engineInfo().version) throw new Error("native addon unavailable");
console.log("HERON_NATIVE_LOADED");
const mode = process.argv.at(-1);
app.whenReady().then(async () => {
  await new Promise(resolve => setTimeout(resolve, 1500));
  if (mode === "native") process.crash();
  if (mode === "revoke") { reporting.applyConsent(false); process.crash(); }
  if (mode === "javascript") { setImmediate(() => { throw new Error("HERON_JAVASCRIPT_CRASH_SMOKE"); }); return; }
  await new Promise(resolve => setTimeout(resolve, 2000));
  await Sentry.flush(5000);
  app.exit(0);
});
`
  )

  assert.notEqual(await run("native"), 0, "the isolated Electron process must actually crash")
  assert.equal(await run("relaunch"), 0)
  assert(
    reports.some((body) => body.includes("event.minidump")),
    "native minidump must reach the local ingest server after restart"
  )
  reports.length = 0
  assert.equal(await run("javascript"), 1)
  assert(
    reports.some((body) => body.includes("HERON_JAVASCRIPT_CRASH_SMOKE")),
    "main-process fatal errors must reach the local ingest server"
  )
  reports.length = 0
  assert.notEqual(await run("revoke"), 0)
  await writeFile(
    join(fixture, "settings.json"),
    JSON.stringify({
      diagnosticsEnabled: true,
      diagnosticsConsentEpoch: "12345678-1234-1234-1234-123456789abc"
    })
  )
  assert.equal(await run("relaunch"), 0)
  assert.equal(
    reports.length,
    0,
    "re-enabling must not upload crashes from the revoked consent period"
  )
  console.log(
    "Crash reporting smoke passed: native relaunch, JavaScript fatal error, consent isolation (localhost only)."
  )
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  await rm(fixture, { recursive: true, force: true })
}
