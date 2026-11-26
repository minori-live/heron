import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { canUsePrSmokeBuild, classifyDocumentation } from "./ci-docs-only.ts"
import { hasFullCoverage, resolveHistory } from "./ci-run-history.ts"

const base = "a".repeat(40)
const skipped = "b".repeat(40)
const head = "c".repeat(40)
const jobs = [
  "Gate",
  "Test / Static and design checks",
  "Test / Checks (Linux x64)",
  "Test / Checks (Windows x64)",
  "Test / Checks (macOS)",
  "Test / Electron end-to-end (Linux x64)",
  "Build / Package (Linux x64)",
  "Build / Package (Linux arm64)",
  "Build / Package (Windows x64)",
  "Build / Package (macOS universal)",
  "Nix / Source build (x86_64-linux)",
  "Nix / Source build (aarch64-linux)",
  "Nix / Source build (aarch64-darwin)"
].map((name) => ({ name, conclusion: "success" }))

function run(id: number, sha: string, conclusion = "success", event = "push") {
  return { id, head_sha: sha, status: "completed", conclusion, event }
}

test("green partial runs, omitted macOS packaging, and failed jobs do not prove full coverage", () => {
  assert.equal(hasFullCoverage(jobs), true)
  assert.equal(
    hasFullCoverage(jobs.filter((job) => job.name !== "Build / Package (macOS universal)")),
    false
  )
  assert.equal(
    hasFullCoverage([...jobs.slice(0, -1), { ...jobs.at(-1)!, conclusion: "skipped" }]),
    false
  )
})

test("main history ignores non-ancestors, failed runs and green runs with partial evidence", async () => {
  const result = await resolveHistory(
    "push",
    head,
    async () => [
      run(5, head),
      run(4, "d".repeat(40)),
      run(3, skipped, "failure"),
      run(2, skipped),
      run(1, base)
    ],
    async (id) => (id === 1 ? jobs : jobs.slice(0, 1)),
    (sha) => sha === base || sha === skipped
  )
  assert.deepEqual(result, { base, skip: false })
})

test("scheduled reuse needs exact SHA and full successful evidence, not an earlier green skip", async () => {
  const readJobs = async (id: number) => (id === 1 ? jobs : jobs.slice(0, 1))
  const resolve = (runs: ReturnType<typeof run>[]) =>
    resolveHistory(
      "schedule",
      head,
      async () => runs,
      readJobs,
      () => true
    )
  assert.deepEqual(await resolve([run(2, head, "success", "schedule"), run(1, head)]), {
    base: "",
    skip: true
  })
  assert.deepEqual(await resolve([run(2, head, "success", "schedule"), run(1, base)]), {
    base: "",
    skip: false
  })
  assert.deepEqual(await resolve([run(2, head, "failure"), run(1, head)]), {
    base: "",
    skip: false
  })
  assert.deepEqual(await resolve([run(1, head, "success", "pull_request")]), {
    base: "",
    skip: false
  })
})

test("unavailable history never reduces coverage", async () => {
  assert.deepEqual(
    await resolveHistory(
      "schedule",
      head,
      async () => {
        throw new Error("403")
      },
      async () => jobs,
      () => true
    ),
    { base: "", skip: false }
  )
})

test("a docs push after cancelled product CI still includes the unvalidated product change", () => {
  const repo = mkdtempSync(join(tmpdir(), "heron-ci-orchestration-"))
  try {
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: repo,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      }).trim()
    const commit = (message: string) => {
      git("add", ".")
      git(
        "-c",
        "user.name=CI Test",
        "-c",
        "user.email=ci@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.hooksPath=.git/no-hooks",
        "commit",
        "-m",
        message
      )
      return git("rev-parse", "HEAD")
    }
    git("init", "-q")
    writeFileSync(join(repo, "README.md"), "baseline\n")
    const validated = commit("validated")
    writeFileSync(join(repo, "product.ts"), "export const changed = true\n")
    const cancelled = commit("unvalidated product")
    writeFileSync(join(repo, "README.md"), "new docs\n")
    const docs = commit("docs")
    const event = { before: cancelled, after: docs }
    assert.equal(classifyDocumentation("push", "refs/heads/main", event, repo, validated), false)
    assert.equal(classifyDocumentation("push", "refs/heads/main", event, repo, cancelled), true)
    assert.equal(classifyDocumentation("push", "refs/heads/main", event, repo), false)
    assert.equal(
      classifyDocumentation("workflow_dispatch", "refs/heads/main", event, repo, cancelled),
      false
    )
    assert.equal(
      canUsePrSmokeBuild({ pull_request: { base: { sha: validated }, head: { sha: docs } } }, repo),
      true
    )
    assert.equal(canUsePrSmokeBuild({}, repo), false)
    mkdirSync(join(repo, ".github", "workflows"), { recursive: true })
    writeFileSync(join(repo, ".github", "workflows", "ci.yml"), "name: CI\n")
    const ci = commit("workflow")
    assert.equal(
      canUsePrSmokeBuild({ pull_request: { base: { sha: docs }, head: { sha: ci } } }, repo),
      false
    )
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})
