import { execFileSync } from "node:child_process"
import { appendFileSync } from "node:fs"

interface Run {
  id: number
  head_sha: string
  status: string
  conclusion: string | null
  event: string
}

interface Job {
  name: string
  conclusion: string | null
}

// A green workflow alone is insufficient: docs-only and deduplicated runs
// can also be green without checking any packages.
const fullJobs = [
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
]

export function hasFullCoverage(jobs: Job[]): boolean {
  const passed = new Set(jobs.filter((job) => job.conclusion === "success").map((job) => job.name))
  return fullJobs.every((name) => passed.has(name))
}

function isSha(value: string) {
  return /^[0-9a-f]{40}$/u.test(value) && !/^0+$/u.test(value)
}

export async function resolveHistory(
  event: "push" | "schedule",
  sha: string,
  readRuns: () => Promise<Run[]>,
  readJobs: (id: number) => Promise<Job[]>,
  isAncestor: (base: string, head: string) => boolean
): Promise<{ base: string; skip: boolean }> {
  const full = { base: "", skip: false }
  if (!isSha(sha)) return full
  try {
    const runs = (await readRuns()).filter(
      (run) =>
        run.status === "completed" &&
        ["push", "schedule", "workflow_dispatch"].includes(run.event) &&
        isSha(run.head_sha) &&
        Number.isSafeInteger(run.id) &&
        run.id > 0
    )
    const candidates = event === "schedule" ? runs.filter((run) => run.head_sha === sha) : runs
    for (const run of candidates.slice(0, 10)) {
      if (run.conclusion !== "success") {
        // A newer full run may have exposed a problem on this exact commit.
        if (event === "schedule" && run.conclusion === "failure") return full
        continue
      }
      if (event === "push" && (run.head_sha === sha || !isAncestor(run.head_sha, sha))) continue
      if (!hasFullCoverage(await readJobs(run.id))) continue
      return event === "schedule" ? { base: "", skip: true } : { base: run.head_sha, skip: false }
    }
  } catch {
    // Denied/unavailable history is never a reason to reduce coverage.
  }
  return full
}

if (import.meta.main) {
  const scope = process.env.GITHUB_REPOSITORY ?? ""
  const event = process.env.GITHUB_EVENT_NAME
  const sha = process.env.GITHUB_SHA ?? ""
  const token = process.env.GITHUB_TOKEN
  const output = process.env.GITHUB_OUTPUT
  const api = process.env.GITHUB_API_URL ?? "https://api.github.com"
  if (
    !output ||
    !token ||
    !/^[\w.-]+\/[\w.-]+$/u.test(scope) ||
    process.env.GITHUB_REF !== "refs/heads/main" ||
    (event !== "push" && event !== "schedule")
  ) {
    throw new Error("CI history lookup requires the main push or schedule context")
  }
  async function read<T>(path: string): Promise<T> {
    const response = await fetch(api + "/repos/" + scope + path, {
      headers: { accept: "application/vnd.github+json", authorization: "Bearer " + token },
      signal: AbortSignal.timeout(5000)
    })
    if (!response.ok) throw new Error("Actions history request failed: " + response.status)
    return (await response.json()) as T
  }
  const result = await resolveHistory(
    event,
    sha,
    async () =>
      (
        await read<{ workflow_runs: Run[] }>(
          "/actions/workflows/ci.yml/runs?branch=main&status=completed&per_page=30" +
            (event === "schedule" ? "&head_sha=" + sha : "")
        )
      ).workflow_runs,
    async (id) =>
      (await read<{ jobs: Job[] }>("/actions/runs/" + id + "/jobs?filter=latest&per_page=100"))
        .jobs,
    (base, head) => {
      try {
        execFileSync("git", ["merge-base", "--is-ancestor", base, head], { stdio: "ignore" })
        return true
      } catch {
        return false
      }
    }
  )
  console.log(
    result.skip
      ? "Exact main SHA already passed the full matrix."
      : result.base
        ? "Classifying against validated main ancestor " + result.base
        : "No trusted full CI evidence found; running full validation."
  )
  appendFileSync(output, "main_base_sha=" + result.base + "\nskip_schedule=" + result.skip + "\n")
}
