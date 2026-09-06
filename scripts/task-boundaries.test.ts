import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"
import { summarizeSccache } from "./ci-sccache-report.ts"

const workspaceRoot = resolve(import.meta.dirname, "..")

await test("macOS packaging has a single task definition and builds each artifact once", (context) => {
  const scratch = mkdtempSync(join(tmpdir(), "heron-task-graph-"))
  context.after(() => rmSync(scratch, { recursive: true, force: true }))
  const env = {
    ...process.env,
    MISE_STATE_DIR: join(scratch, "state"),
    MISE_CACHE_DIR: join(scratch, "cache"),
    MISE_TRUSTED_CONFIG_PATHS: workspaceRoot,
    COLUMNS: "300"
  }
  for (const [task, config] of [
    ["ci:package:macos-universal", "electron-builder.universal.yml"],
    ["ci:package:macos-universal-release", "electron-builder.release.yml"]
  ] as const) {
    const info = spawnSync("mise", ["tasks", "info", task, "--json"], {
      cwd: workspaceRoot,
      env,
      encoding: "utf8"
    })
    assert.equal(info.status, 0, info.stderr)
    const parsed = JSON.parse(info.stdout) as { config_sources: string[] }
    assert.equal(parsed.config_sources.length, 1, `${task} merges multiple task definitions`)

    const preview = spawnSync("mise", ["run", "--dry-run", "--force", task], {
      cwd: workspaceRoot,
      env,
      encoding: "utf8"
    })
    assert.equal(preview.status, 0, preview.stderr)
    const commands = `${preview.stdout}\n${preview.stderr}`
    assert.equal(commands.match(/napi build --platform --release --target /gu)?.length, 2)
    assert.equal(commands.match(/napi universalize/gu)?.length, 1)
    assert.equal(
      commands.match(/cargo xtask native universal-macos --profile release/gu)?.length,
      1
    )
    assert.equal(commands.match(/pnpm build:desktop/gu)?.length, 1)
    const distCommands = [...commands.matchAll(/pnpm --filter @heron\/desktop dist\b([^\r\n]*)/gu)]
    assert.equal(distCommands.length, 1)
    const args = distCommands[0][1].trim().split(/\s+/u)
    const configIndex = args.indexOf("--config")
    assert.notEqual(configIndex, -1)
    assert.equal(args[configIndex + 1], config)
    assert.ok(args.includes("--universal"))
  }
})

await test("sccache diagnostics report failed writes without exposing authenticated URLs", () => {
  const { summary, errors } = summarizeSccache(
    {
      stats: {
        cache_hits: { counts: { Rust: 157, "C/C++": 1 } },
        cache_misses: { counts: { Rust: 873, "C/C++": 4 } },
        cache_writes: 0,
        cache_write_errors: 877,
        cache_read_errors: 0
      }
    },
    "429 Too Many Requests https://cache.example/?token=private-runner-token",
    false
  )
  assert.equal(errors, 877)
  assert.match(summary, /15\.3%/u)
  assert.match(summary, /rate limiting/u)
  assert.doesNotMatch(summary, /private-runner-token|https:\/\//u)
})

await test("read-only sccache misses are not reported as write failures", () => {
  const { summary, errors } = summarizeSccache(
    {
      stats: {
        cache_hits: { counts: {} },
        cache_misses: { counts: { Rust: 20 } },
        cache_writes: 0,
        cache_write_errors: 0,
        cache_read_errors: 0
      }
    },
    "",
    true
  )
  assert.equal(errors, 0)
  assert.match(summary, /READ_ONLY/u)
  assert.match(summary, /0\.0%/u)
})

const packageManifests = [
  "package.json",
  "apps/design-system/package.json",
  "apps/desktop/package.json",
  "apps/desktop/scripts/vst3-editor-smoke-app/package.json",
  "crates/dsp-node/package.json",
  "docs/package.json",
  "packages/contracts/package.json",
  "packages/project-db/package.json",
  "packages/project-model/package.json",
  "packages/ui/package.json"
]

await test("pnpm scripts remain JavaScript ecosystem leaf tasks", async () => {
  const violations: string[] = []
  const forbidden =
    /\b(?:cargo|rustc|rustup|mise)\b|scripts\/(?:cargo-host|native-build|rust-target|test-coverage)\.ts/u

  for (const manifest of packageManifests) {
    const source = await readFile(resolve(workspaceRoot, manifest), "utf8")
    const parsed = JSON.parse(source) as { scripts?: Record<string, string> }
    for (const [name, command] of Object.entries(parsed.scripts ?? {})) {
      if (forbidden.test(command)) violations.push(`${manifest}#${name}: ${command}`)
    }
  }

  assert.deepEqual(violations, [])
})

await test("xtask does not invoke JavaScript ecosystem tools", async () => {
  const source = await readFile(resolve(workspaceRoot, "xtask/src/lib.rs"), "utf8")
  assert.doesNotMatch(source, /Command::new\([^\n]*(?:node|pnpm)/u)
  assert.doesNotMatch(source, /CommandSpec[^\n]*(?:node|pnpm)/u)
})

await test("GitHub workflows use mise for repository task execution", async () => {
  const workflows = [
    ".github/workflows/build.yml",
    ".github/workflows/ci.yml",
    ".github/workflows/test.yml"
  ]
  const forbidden = [
    "pnpm build:native",
    "pnpm docs:build",
    "pnpm ${{ matrix.check-script }}",
    "cargo build",
    "cargo truce build",
    "exec electron-builder"
  ]
  const violations: string[] = []

  for (const workflow of workflows) {
    const source = await readFile(resolve(workspaceRoot, workflow), "utf8")
    for (const command of forbidden) {
      if (source.includes(command)) violations.push(`${workflow}: ${command}`)
    }
  }

  assert.deepEqual(violations, [])
})

await test("Windows native coverage exposes the mise cargo-llvm-cov binary", async () => {
  const task = await readFile(
    resolve(workspaceRoot, ".mise/tasks/ci/check/native-coverage"),
    "utf8"
  )

  assert.match(task, /RUNNER_OS:-.*Windows/u)
  assert.match(task, /mise which cargo-llvm-cov/u)
  assert.match(task, /cygpath -u/u)
})

await test("universal macOS packaging includes only the universal DSP binding", async () => {
  const universalConfig = await readFile(
    resolve(workspaceRoot, "apps/desktop/electron-builder.universal.yml"),
    "utf8"
  )
  const releaseConfig = await readFile(
    resolve(workspaceRoot, "apps/desktop/electron-builder.release.yml"),
    "utf8"
  )
  assert.match(universalConfig, /extends: \.\/electron-builder\.yml/u)
  assert.match(universalConfig, /\*\.darwin-arm64\.node/u)
  assert.match(universalConfig, /\*\.darwin-x64\.node/u)
  assert.match(releaseConfig, /extends: \.\/electron-builder\.universal\.yml/u)
})
