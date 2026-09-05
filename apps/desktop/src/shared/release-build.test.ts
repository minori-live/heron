import { describe, expect, it } from "vitest"
import { releaseBuild } from "./release-build"

describe("release build eligibility", () => {
  it("keeps local and ordinary CI builds disabled, even at a tag", () => {
    expect(releaseBuild("1.0.0", {})).toBeNull()
    expect(releaseBuild("1.0.0", { GITHUB_REF: "refs/tags/v1.0.0" })).toBeNull()
  })
  it.each(["1.0.0", "1.1.0-beta.2", "1.1.0-rc.1"])("embeds the validated release %s", (version) => {
    expect(
      releaseBuild(version, {
        HERON_RELEASE_BUILD: "true",
        GITHUB_REF: `refs/tags/v${version}`,
        GITHUB_EVENT_NAME: "push"
      })
    ).toEqual({ version, channel: version.split("-")[1]?.split(".")[0] ?? "latest" })
  })
  it.each(["refs/heads/main", "refs/tags/v0.9.0"])("rejects mismatched ref %s", (ref) => {
    expect(() =>
      releaseBuild("1.0.0", {
        HERON_RELEASE_BUILD: "true",
        GITHUB_REF: ref,
        GITHUB_EVENT_NAME: "push"
      })
    ).toThrow()
  })
  it("rejects manual runs and unsupported version channels", () => {
    expect(() =>
      releaseBuild("1.0.0", {
        HERON_RELEASE_BUILD: "true",
        GITHUB_REF: "refs/tags/v1.0.0",
        GITHUB_EVENT_NAME: "workflow_dispatch"
      })
    ).toThrow()
    expect(() =>
      releaseBuild("1.0.0-dev.1", {
        HERON_RELEASE_BUILD: "true",
        GITHUB_REF: "refs/tags/v1.0.0-dev.1",
        GITHUB_EVENT_NAME: "push"
      })
    ).toThrow()
  })
})
