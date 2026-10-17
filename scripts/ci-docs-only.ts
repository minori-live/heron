import { execFileSync } from "node:child_process"
import { appendFileSync, readFileSync } from "node:fs"

interface ChangeEvent {
  before?: string
  after?: string
  pull_request?: { base?: { sha?: string }; head?: { sha?: string } }
}

function isCommit(value: string | undefined): value is string {
  return value !== undefined && /^[a-f0-9]{40}$/u.test(value) && !/^0+$/u.test(value)
}

function isDocumentation(path: string): boolean {
  // Deliberately exclude .agents, docs theme/configuration, scripts, manifests,
  // lockfiles, and assets that can contain executable code (including SVG).
  return (
    path === "README.md" ||
    path === "AGENTS.md" ||
    /^(?:agents\/docs|docs\/content)\/.+\.md$/u.test(path) ||
    /^docs\/content\/public\/.+\.(?:png|jpe?g|gif|webp|ico)$/u.test(path)
  )
}

export function isDocumentationDiff(raw: string): boolean {
  // --no-renames represents a move as a deletion and addition. Both paths must
  // qualify, so moving source code into a docs directory cannot hide its removal.
  const fields = raw.split("\0")
  if (fields.pop() !== "" || fields.length === 0 || fields.length % 2 !== 0) return false
  for (let index = 0; index < fields.length; index += 2) {
    const header = fields[index] ?? ""
    const path = fields[index + 1] ?? ""
    // Only regular non-executable files or their addition/deletion are allowed.
    // Type changes, symlinks, submodules, and unknown statuses require full CI.
    if (
      !/^:(?:100644|000000) (?:100644|000000) [a-f0-9]{40} [a-f0-9]{40} [AMD]$/u.test(header) ||
      !isDocumentation(path)
    ) {
      return false
    }
  }
  return true
}

export function classifyDocumentation(
  eventName: string,
  ref: string,
  event: ChangeEvent,
  cwd = process.cwd()
): boolean {
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  try {
    let base: string
    let head: string
    if (eventName === "pull_request") {
      const pullRequest = event.pull_request
      if (!isCommit(pullRequest?.base?.sha) || !isCommit(pullRequest?.head?.sha)) return false
      head = pullRequest.head.sha
      // The entire PR, not just its latest commit or the synthetic merge commit.
      base = git("merge-base", pullRequest.base.sha, head).trim()
      if (!isCommit(base)) return false
    } else if (eventName === "push" && ref === "refs/heads/main") {
      if (!isCommit(event.before) || !isCommit(event.after)) return false
      base = event.before
      head = event.after
    } else {
      // Manual runs, tags, and future event types always keep full validation.
      return false
    }
    return isDocumentationDiff(
      git("diff", "--raw", "--no-abbrev", "--no-renames", "-z", base, head, "--")
    )
  } catch {
    console.warn("::warning::Unable to classify the complete change; running full CI.")
    return false
  }
}

if (import.meta.main) {
  let docsOnly = false
  try {
    const event = JSON.parse(
      readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8")
    ) as ChangeEvent
    docsOnly = classifyDocumentation(
      process.env.GITHUB_EVENT_NAME ?? "",
      process.env.GITHUB_REF ?? "",
      event
    )
  } catch {
    console.warn("::warning::Unable to read the change event; running full CI.")
  }
  console.log(
    docsOnly ? "Documentation-only: retaining static and docs validation." : "Full CI required."
  )
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `docs_only=${docsOnly}\n`)
}
