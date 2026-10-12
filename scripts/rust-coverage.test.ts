import assert from "node:assert/strict"
import test from "node:test"
import { coverageSteps, parseCoverageEnvironment, runCoverageSteps } from "./rust-coverage.ts"

function encodedEnvironment(environment: Record<string, string>): string {
  return Object.entries(environment)
    .map(([name, value]) => {
      const encoded = [...value]
        .map((character) => `\`u{${character.codePointAt(0)!.toString(16)}}`)
        .join("")
      return `$env:${name}="${encoded}"`
    })
    .join("\r\n")
}

await test("coverage environment preserves paths and flags as literal data without shell expansion", () => {
  const environment = {
    CARGO_LLVM_COV: "1",
    LLVM_PROFILE_FILE: "C:\\Heron user's 音频\\target-coverage\\heron-%p-%10m.profraw",
    __CARGO_LLVM_COV_RUSTC_WRAPPER_RUSTFLAGS: '-C\u001finstrument-coverage\u001f--cfg="coverage"',
    RUSTC_WRAPPER: "C:\\tools\\$(literal) `name`\\cargo-llvm-cov.exe"
  }
  assert.deepEqual(parseCoverageEnvironment(encodedEnvironment(environment)), environment)
  assert.throws(() => parseCoverageEnvironment('export CARGO_LLVM_COV="1"'))
  assert.throws(() => parseCoverageEnvironment(""))
})

await test("coverage reports include native bindings and CI fixture runs before export", () => {
  const target = "x86_64-unknown-linux-gnu"
  for (const mode of ["local", "ci", "native"] as const) {
    const steps = coverageSteps(mode, target)
    const clean = steps.findIndex((step) => step.args.includes("clean"))
    const rustTests = steps.findIndex((step) => step.command === "cargo" && step.args[0] === "test")
    const addon = steps.findIndex((step) => step.args.includes("build:debug"))
    const bindings = steps.findIndex((step) => step.args.includes("test:native-bindings"))
    const report = steps.findIndex((step) => step.args.includes("report"))
    assert.equal(clean, 0)
    assert.ok(clean < rustTests && rustTests < addon && addon < bindings && bindings < report)
    assert.deepEqual(steps[rustTests]?.args, [
      "test",
      "--workspace",
      "--features",
      "heron-dsp-node/bench-internals",
      "--target",
      target
    ])
    assert.ok(steps.slice(0, report + 1).every((step) => step.instrumented))
    assert.ok(steps[report]?.args.includes(target))
    assert.ok(steps[report]?.args.includes("coverage/rust/lcov.info"))
    assert.ok(steps[report + 1]?.args.includes("scripts/rewrite-lcov-paths.ts"))

    const fixtures = steps.findIndex((step) => step.args.includes("test:official-plugin-fixtures"))
    const javascript = steps.findIndex((step) => step.args.includes("test:coverage:js"))
    if (mode === "ci") {
      assert.ok(bindings < fixtures && fixtures < report)
      assert.ok(steps.some((step) => step.args.includes("test:scripts")))
    } else {
      assert.equal(fixtures, -1)
    }
    assert.equal(javascript >= 0, mode !== "native")
  }
})

await test("native coverage restores the caller environment for desktop and database tests", async () => {
  const baseEnvironment = { CARGO_TARGET_DIR: "custom-target", RUSTC_WRAPPER: "sccache" }
  const coverageEnvironment = {
    ...baseEnvironment,
    CARGO_TARGET_DIR: "target-coverage",
    LLVM_PROFILE_FILE: "target-coverage/heron-%p-%10m.profraw",
    RUSTC_WRAPPER: "cargo-llvm-cov"
  }
  const requests: { args: readonly string[]; env: NodeJS.ProcessEnv | undefined }[] = []
  await runCoverageSteps(
    "native",
    "x86_64-pc-windows-msvc",
    baseEnvironment,
    coverageEnvironment,
    async (_command, args, options) => {
      requests.push({ args, env: options?.env })
    }
  )
  assert.ok(requests.slice(0, -2).every(({ env }) => env === coverageEnvironment))
  assert.deepEqual(requests.slice(-2), [
    { args: ["--filter", "@heron/desktop", "test:unit"], env: baseEnvironment },
    { args: ["--filter", "@heron/project-db", "test:integration"], env: baseEnvironment }
  ])
  assert.equal(baseEnvironment.CARGO_TARGET_DIR, "custom-target")
  assert.equal(baseEnvironment.RUSTC_WRAPPER, "sccache")
})
