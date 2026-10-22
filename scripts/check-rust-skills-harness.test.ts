import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import path from "node:path"
import test from "node:test"
import { assertStandaloneHarness } from "./check-rust-skills-harness.ts"

await test("accepts only the harness directory as its workspace root", () => {
  const repoRoot = "/workspace"
  assert.doesNotThrow(() =>
    assertStandaloneHarness(path.resolve(repoRoot, ".agents/skills/rust-skills/checks"), repoRoot)
  )
  assert.throws(
    () => assertStandaloneHarness(repoRoot, repoRoot),
    /Exclude \.agents\/skills\/rust-skills\/checks/
  )
})

await test("cargo metadata loads the harness outside the Heron workspace", () => {
  const result = spawnSync(process.execPath, ["scripts/check-rust-skills-harness.ts"], {
    encoding: "utf8"
  })
  assert.equal(result.status, 0, result.stderr)
})
