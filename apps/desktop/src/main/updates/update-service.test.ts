import { describe, expect, it, vi } from "vitest"
import { UpdateService } from "./update-service"

function harness(enabled = true) {
  const driver = {
    check: vi.fn(async () => "1.1.0"),
    download: vi.fn(async (_progress: (n: number) => void) => {}),
    install: vi.fn(),
    dispose: vi.fn()
  }
  const options = {
    currentVersion: "1.0.0",
    channel: enabled ? "latest" : null,
    driver: enabled ? driver : null,
    isIdle: vi.fn(async () => true),
    hasProject: vi.fn(() => false),
    prepareInstall: vi.fn(async () => true),
    publish: vi.fn()
  }
  const service = new UpdateService(options)
  return { service, driver, options }
}

async function ready(service: UpdateService) {
  service.command("check", "check")
  await vi.waitFor(() => expect(service.snapshot().phase).toBe("available"))
  service.command("download", "download")
  await vi.waitFor(() => expect(service.snapshot().phase).toBe("ready"))
}

describe("application update service", () => {
  it("never calls the driver for non-release builds", async () => {
    const { service, driver } = harness(false)
    await service.tick()
    expect(service.command("check", "a")).toMatchObject({ accepted: false, reason: "disabled" })
    expect(driver.check).not.toHaveBeenCalled()
  })
  it("defers background checks and downloads during audio work", async () => {
    const { service, driver, options } = harness()
    options.isIdle.mockResolvedValue(false)
    await service.tick()
    expect(driver.check).not.toHaveBeenCalled()
    service.command("check", "a")
    await vi.waitFor(() => expect(service.snapshot().phase).toBe("available"))
    service.command("download", "b")
    await vi.waitFor(() => expect(service.snapshot().phase).toBe("available"))
    expect(driver.download).not.toHaveBeenCalled()
    options.isIdle.mockResolvedValue(true)
    await service.tick()
    expect(service.snapshot().phase).toBe("ready")
  })
  it("replays accepted commands without duplicate downloads or installs", async () => {
    const { service, driver, options } = harness()
    await ready(service)
    service.command("download", "download")
    let finish!: (value: boolean) => void
    options.prepareInstall.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const receipt = service.command("install", "install")
    expect(service.command("install", "install")).toEqual(receipt)
    await vi.waitFor(() => expect(options.prepareInstall).toHaveBeenCalledOnce())
    expect(driver.install).not.toHaveBeenCalled()
    finish(true)
    await vi.waitFor(() => expect(driver.install).toHaveBeenCalledOnce())
    expect(driver.download).toHaveBeenCalledOnce()
  })
  it("requires project closure and refuses installation if audio becomes busy", async () => {
    const { service, driver, options } = harness()
    await ready(service)
    options.hasProject.mockReturnValue(true)
    expect(service.command("install", "a")).toMatchObject({
      accepted: false,
      reason: "project-open"
    })
    options.hasProject.mockReturnValue(false)
    options.isIdle.mockResolvedValue(false)
    service.command("install", "b")
    await vi.waitFor(() => expect(service.snapshot().phase).toBe("ready"))
    expect(driver.install).not.toHaveBeenCalled()
  })
  it("quarantines failed shutdown without invoking the installer", async () => {
    const { service, driver, options } = harness()
    await ready(service)
    options.prepareInstall.mockResolvedValue(false)
    service.command("install", "a")
    await vi.waitFor(() =>
      expect(service.snapshot()).toMatchObject({ phase: "quarantined", error: "shutdown-failed" })
    )
    expect(driver.install).not.toHaveBeenCalled()
    expect(service.command("install", "b").accepted).toBe(false)
  })
  it("recovers from a failed verification by checking and downloading again", async () => {
    const { service, driver } = harness()
    driver.download.mockRejectedValueOnce(new Error("checksum"))
    service.command("check", "a")
    await vi.waitFor(() => expect(service.snapshot().phase).toBe("available"))
    service.command("download", "b")
    await vi.waitFor(() => expect(service.snapshot().error).toBe("download-failed"))
    await ready(service)
    expect(driver.install).not.toHaveBeenCalled()
  })
})
