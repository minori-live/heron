import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import type { App } from "electron"
import type { ReleaseBuild } from "../../shared/release-build"

declare const __HERON_BUILD_MODE__: string
declare const __HERON_RELEASE__: ReleaseBuild | null

type ProfileApplication = Pick<App, "getPath" | "setPath" | "getVersion" | "isPackaged">
type ApplicationEnvironment = "production" | "development" | "test"
const NONPRODUCTION_MARKER = ".heron-nonproduction"

export function reportingEnvironment(
  application: ProfileApplication,
  environment: NodeJS.ProcessEnv,
  runtimeArguments: readonly string[] = [...process.argv, ...process.execArgv]
): ApplicationEnvironment {
  const mode = typeof __HERON_BUILD_MODE__ === "undefined" ? null : __HERON_BUILD_MODE__
  const release = typeof __HERON_RELEASE__ === "undefined" ? null : __HERON_RELEASE__
  const testEnvironment = Object.keys(environment).some(
    (key) =>
      environment[key] !== undefined &&
      (/^HERON_TEST_/.test(key) ||
        /^(CI|VITEST.*|JEST_WORKER_ID|NODE_TEST_CONTEXT|PLAYWRIGHT_.*|PW_TEST_.*|HERON_E2E_EXECUTABLE|ELECTRON_RUN_AS_NODE)$/.test(
          key
        ))
  )
  const harnessArguments = [...runtimeArguments, ...(environment.NODE_OPTIONS?.split(/\s+/) ?? [])]
  const hasHarnessArgument = harnessArguments.some((argument) =>
    /^--(?:inspect(?:-[a-z-]+)?|remote-debugging-[a-z-]+|enable-automation|test(?:-[a-z-]+)?)(?:=|$)/.test(
      argument
    )
  )
  if (
    testEnvironment ||
    hasHarnessArgument ||
    mode === "test" ||
    environment.NODE_ENV === "test" ||
    existsSync(join(application.getPath("userData"), NONPRODUCTION_MARKER))
  )
    return "test"
  if (
    application.isPackaged !== true ||
    mode !== "production" ||
    !release ||
    release.version !== application.getVersion() ||
    environment.HERON_RENDERER_URL !== undefined ||
    (environment.HERON_RELEASE_BUILD !== undefined && environment.HERON_RELEASE_BUILD !== "true") ||
    (environment.NODE_ENV !== undefined && environment.NODE_ENV !== "production")
  )
    return "development"
  return "production"
}

function canonicalPath(path: string): string {
  if (existsSync(path)) return realpathSync(path)
  const parent = dirname(path)
  return parent === path ? path : join(canonicalPath(parent), relative(parent, path))
}

function containsPath(parent: string, path: string): boolean {
  const location = relative(parent, path)
  return (
    location === "" ||
    (location !== ".." && !location.startsWith(`..${sep}`) && !isAbsolute(location))
  )
}

export function configureReportingProfile(
  application: ProfileApplication,
  environment: NodeJS.ProcessEnv
): void {
  const mode = reportingEnvironment(application, environment)
  if (mode === "production") return
  const profile = environment.HERON_TEST_USER_DATA
    ? resolve(environment.HERON_TEST_USER_DATA)
    : join(application.getPath("appData"), mode === "test" ? "Heron Test" : "Heron Development")
  const productionProfile = canonicalPath(application.getPath("userData"))
  const isolatedProfile = canonicalPath(profile)
  if (
    containsPath(productionProfile, isolatedProfile) ||
    containsPath(isolatedProfile, productionProfile)
  ) {
    throw new Error("Development and test profiles must be separate from production user data")
  }
  mkdirSync(profile, { recursive: true })
  // This provenance also blocks uploads if a nonproduction profile is later copied
  // or selected by a packaged release. Never promote its cached dumps to production.
  writeFileSync(join(profile, NONPRODUCTION_MARKER), "development/test\n")
  const sessionData = join(profile, "session-data")
  const crashDumps = join(profile, "crash-dumps")
  mkdirSync(sessionData, { recursive: true })
  mkdirSync(crashDumps, { recursive: true })
  application.setPath("userData", profile)
  application.setPath("sessionData", sessionData)
  application.setPath("crashDumps", crashDumps)
}
