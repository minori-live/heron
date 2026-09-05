export interface ReleaseBuild {
  version: string
  channel: string
}

export function releaseBuild(
  version: string,
  environment: Record<string, string | undefined>
): ReleaseBuild | null {
  if (environment.HERON_RELEASE_BUILD !== "true") return null
  if (
    environment.GITHUB_REF !== `refs/tags/v${version}` ||
    environment.GITHUB_EVENT_NAME !== "push"
  ) {
    throw new Error("Update-enabled builds require the validated tag-push workflow")
  }
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.(0|[1-9]\d*))?$/.exec(version)
  if (!match) throw new Error("Release versions must be X.Y.Z or X.Y.Z-alpha/beta/rc.N")
  return { version, channel: match[4] ?? "latest" }
}
