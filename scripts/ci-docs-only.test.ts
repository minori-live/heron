import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test, { type TestContext } from "node:test"
import { classifyDocumentation, isDocumentationDiff } from "./ci-docs-only.ts"

const sha = "a".repeat(40)
const rawChange = (path: string, oldMode = "100644", newMode = "100644", status = "M") =>
  `:${oldMode} ${newMode} ${sha} ${sha} ${status}\0${path}\0`

await test("only explicit documentation content paths can skip heavy CI", () => {
  for (const path of [
    "README.md",
    "AGENTS.md",
    "agents/docs/ci.md",
    "docs/content/zh/manual/first-project.md",
    "docs/content/manual/a page with spaces.md",
    "docs/content/public/screenshots/mixer.png"
  ]) {
    assert.equal(isDocumentationDiff(rawChange(path)), true, path)
  }
  for (const path of [
    ".github/workflows/ci.yml",
    ".agents/skills/example/SKILL.md",
    "apm.yml",
    "apm.lock.yaml",
    "mise.toml",
    "mise.lock",
    "pnpm-lock.yaml",
    "docs/package.json",
    "docs/.vitepress/config.ts",
    "docs/content/example.ts",
    "docs/content/public/install.sh",
    "docs/content/public/logo.svg",
    "docs/content/public/CNAME",
    "agents/docs/example.vue",
    "apps/desktop/README.md",
    "docs/content/manual/page.md\nsource.ts"
  ]) {
    assert.equal(isDocumentationDiff(rawChange(path)), false, path)
  }
  assert.equal(isDocumentationDiff(rawChange("README.md") + rawChange("Cargo.lock")), false)
})

await test("additions and deletions qualify but executable files, links, and uncertain diffs do not", () => {
  assert.equal(isDocumentationDiff(rawChange("README.md", "000000", "100644", "A")), true)
  assert.equal(isDocumentationDiff(rawChange("README.md", "100644", "000000", "D")), true)
  for (const mode of ["100755", "120000", "160000"]) {
    assert.equal(isDocumentationDiff(rawChange("README.md", "100644", mode)), false)
    assert.equal(isDocumentationDiff(rawChange("README.md", mode, "000000", "D")), false)
  }
  for (const raw of ["", "invalid\0README.md\0", rawChange("README.md").slice(0, -1)]) {
    assert.equal(isDocumentationDiff(raw), false)
  }
  assert.equal(isDocumentationDiff(rawChange("README.md", "100644", "100644", "R100")), false)
})

function repository(context: TestContext) {
  const cwd = mkdtempSync(join(tmpdir(), "heron-ci-docs-"))
  context.after(() => rmSync(cwd, { recursive: true, force: true }))
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=CI test", "-c", "user.email=ci@example.invalid", ...args],
      {
        cwd,
        encoding: "utf8"
      }
    ).trim()
  const write = (path: string, value: string) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true })
    writeFileSync(join(cwd, path), value)
  }
  const commit = () => {
    git("add", "--all")
    git("commit", "--quiet", "-m", "Fixture")
    return git("rev-parse", "HEAD")
  }
  git("init", "--quiet", "--initial-branch=main")
  write("README.md", "Initial documentation\n")
  write("source.ts", "export const value = 1\n")
  const initial = commit()
  return { cwd, git, write, commit, initial }
}

await test("PR classification includes earlier source changes and uses the merge base", (context) => {
  const repo = repository(context)
  repo.git("checkout", "--quiet", "-b", "docs")
  repo.write("README.md", "Updated documentation\n")
  const docsHead = repo.commit()
  repo.git("checkout", "--quiet", "main")
  repo.write("source.ts", "export const value = 2\n")
  const mainHead = repo.commit()
  const pr = (head: string) =>
    classifyDocumentation(
      "pull_request",
      "refs/pull/1/merge",
      { pull_request: { base: { sha: mainHead }, head: { sha: head } } },
      repo.cwd
    )
  assert.equal(pr(docsHead), true, "unrelated base-branch changes are not PR changes")
  repo.git("checkout", "--quiet", "docs")
  repo.write("source.ts", "export const value = 3\n")
  repo.commit()
  repo.write("README.md", "Final documentation-only commit\n")
  assert.equal(pr(repo.commit()), false, "a docs-only last commit cannot hide earlier code changes")
})

await test("main pushes inspect the complete before/after diff including both sides of moves", (context) => {
  const repo = repository(context)
  const push = (before: string, after: string) =>
    classifyDocumentation("push", "refs/heads/main", { before, after }, repo.cwd)
  repo.write("README.md", "Updated documentation\n")
  const docsHead = repo.commit()
  assert.equal(push(repo.initial, docsHead), true)
  repo.git("mv", "README.md", "AGENTS.md")
  const renamedDocs = repo.commit()
  assert.equal(push(docsHead, renamedDocs), true)
  repo.git("rm", "AGENTS.md")
  const deletedDocs = repo.commit()
  assert.equal(push(renamedDocs, deletedDocs), true)
  repo.git("mv", "source.ts", "README.md")
  assert.equal(
    push(deletedDocs, repo.commit()),
    false,
    "source removal must not disappear in a rename"
  )
  assert.equal(push(docsHead, docsHead), false, "empty diffs are not evidence for skipping")
  assert.equal(
    push("0".repeat(40), docsHead),
    false,
    "new branch pushes lack a complete before tree"
  )
  assert.equal(push(sha, docsHead), false, "unavailable history falls back to full CI")
})

await test("manual, tag, unrelated push, and malformed events default to full CI", () => {
  const event = { before: sha, after: sha }
  for (const [eventName, ref] of [
    ["workflow_dispatch", "refs/heads/main"],
    ["push", "refs/tags/v1.0.0"],
    ["push", "refs/heads/other"],
    ["merge_group", "refs/heads/main"]
  ]) {
    assert.equal(classifyDocumentation(eventName ?? "", ref ?? "", event), false)
  }
  assert.equal(classifyDocumentation("pull_request", "refs/pull/1/merge", {}), false)
  assert.equal(
    classifyDocumentation("push", "refs/heads/main", { before: "--help", after: sha }),
    false
  )
})

await test("unreadable and invalid event payloads explicitly emit the full-CI output", (context) => {
  const cwd = mkdtempSync(join(tmpdir(), "heron-ci-event-"))
  context.after(() => rmSync(cwd, { recursive: true, force: true }))
  const eventPath = join(cwd, "event.json")
  const outputPath = join(cwd, "output")
  for (const content of [undefined, "{invalid", "null"]) {
    if (content !== undefined) writeFileSync(eventPath, content)
    writeFileSync(outputPath, "")
    execFileSync(process.execPath, [join(import.meta.dirname, "ci-docs-only.ts")], {
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_OUTPUT: outputPath
      }
    })
    assert.equal(readFileSync(outputPath, "utf8"), "docs_only=false\n")
  }
})

await test(
  "the CI gate accepts only a successful full tier or the explicitly classified docs tier",
  { skip: process.platform === "win32" },
  () => {
    const workflow = readFileSync(join(import.meta.dirname, "../.github/workflows/ci.yml"), "utf8")
    // Exercise the actual gate shell, not a duplicate implementation. Its job ID
    // and run step are the boundary; formatting outside that block is irrelevant.
    const block = workflow.match(/^ {2}gate:[\s\S]*?^ {8}run: \|\n((?: {10}.*\n)+)/mu)?.[1]
    assert.ok(block, "Gate must have an executable validation step")
    const script = block.replace(/^ {10}/gmu, "")
    const states = ["success", "failure", "cancelled", "skipped"]
    for (const changes of states) {
      for (const docs of ["true", "false", ""]) {
        for (const tests of states) {
          for (const build of states) {
            for (const nix of states) {
              const expected = docs === "true" ? "skipped" : "success"
              const shouldPass =
                changes === "success" &&
                tests === "success" &&
                build === expected &&
                nix === expected
              const result = spawnSync("bash", ["-c", script], {
                env: {
                  ...process.env,
                  CHANGES_RESULT: changes,
                  DOCS_ONLY: docs,
                  TEST_RESULT: tests,
                  BUILD_RESULT: build,
                  NIX_RESULT: nix
                },
                encoding: "utf8"
              })
              assert.equal(
                result.status === 0,
                shouldPass,
                JSON.stringify({ changes, docs, tests, build, nix, error: result.error })
              )
            }
          }
        }
      }
    }
  }
)

await test(
  "classifier execution failure and missing output cannot leave a positive skip decision",
  { skip: process.platform === "win32" },
  (context) => {
    const workflow = readFileSync(join(import.meta.dirname, "../.github/workflows/ci.yml"), "utf8")
    const block = workflow.match(/^ {2}changes:[\s\S]*?^ {8}run: \|\n((?: {10}.*\n)+)/mu)?.[1]
    assert.ok(block)
    const script = block.replace(/^ {10}/gmu, "")
    const cwd = mkdtempSync(join(tmpdir(), "heron-ci-runtime-"))
    context.after(() => rmSync(cwd, { recursive: true, force: true }))
    const output = join(cwd, "output")
    const node = join(cwd, "node")
    for (const body of ["exit 0", 'echo "docs_only=true" >> "$GITHUB_OUTPUT"\nexit 1']) {
      writeFileSync(node, `#!/bin/sh\n${body}\n`)
      chmodSync(node, 0o755)
      writeFileSync(output, "")
      execFileSync("bash", ["-c", script], {
        env: { ...process.env, PATH: `${cwd}:${process.env.PATH ?? ""}`, GITHUB_OUTPUT: output }
      })
      assert.equal(readFileSync(output, "utf8").trim().split("\n").at(-1), "docs_only=false")
    }
  }
)
