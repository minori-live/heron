import type {
  ApplicationUpdateCommand,
  ApplicationUpdateResult,
  ApplicationUpdateSnapshot,
  UpdateFailure
} from "@heron/contracts"

export interface UpdateDriver {
  check(): Promise<string | null>
  download(progress: (percent: number) => void): Promise<void>
  install(failed: () => void): void
  dispose(): void
}

export interface UpdateServiceOptions {
  currentVersion: string
  channel: string | null
  driver: UpdateDriver | null
  isIdle(): Promise<boolean>
  hasProject(): boolean
  prepareInstall(): Promise<boolean>
  publish(snapshot: ApplicationUpdateSnapshot): void
}

/** Main owns the state machine. Failed requests never install on a later ordinary quit. */
export class UpdateService {
  private state: ApplicationUpdateSnapshot
  private disposed = false
  private timer: ReturnType<typeof setInterval> | null = null
  private polling = false
  private nextCheck = 0
  private readonly requests = new Map<
    string,
    { command: ApplicationUpdateCommand; result: ApplicationUpdateResult }
  >()

  constructor(private readonly options: UpdateServiceOptions) {
    this.state = {
      revision: 0,
      phase: options.driver ? "idle" : "disabled",
      currentVersion: options.currentVersion,
      channel: options.channel,
      availableVersion: null,
      progress: 0,
      error: null
    }
  }

  snapshot(): ApplicationUpdateSnapshot {
    return { ...this.state }
  }

  private update(patch: Partial<ApplicationUpdateSnapshot>): void {
    if (this.disposed) return
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 }
    this.options.publish(this.snapshot())
  }

  private fail(error: UpdateFailure, quarantined = false): void {
    this.update({ phase: quarantined ? "quarantined" : "error", error })
  }

  start(): void {
    if (!this.options.driver || this.timer || this.disposed) return
    // Delay the first request until startup has completed. Never poll from an audio callback.
    this.timer = setInterval(() => {
      void this.tick()
    }, 30_000)
    this.timer.unref()
  }

  async tick(): Promise<void> {
    if (this.disposed || this.polling || !this.options.driver) return
    this.polling = true
    try {
      if (!(await this.options.isIdle())) return
      if (this.state.phase === "available") await this.download()
      else if (["idle", "error"].includes(this.state.phase) && Date.now() >= this.nextCheck) {
        await this.check()
      }
    } catch {
      // An unavailable activity snapshot is not permission to start background work.
    } finally {
      this.polling = false
    }
  }

  replay(key: string, command: ApplicationUpdateCommand): ApplicationUpdateResult | null {
    const previous = this.requests.get(key)
    if (!previous) return null
    return previous.command === command ? structuredClone(previous.result) : this.reject("busy")
  }

  private reject(
    reason: Extract<ApplicationUpdateResult, { accepted: false }>["reason"]
  ): ApplicationUpdateResult {
    return { accepted: false, reason, snapshot: this.snapshot() }
  }

  command(command: ApplicationUpdateCommand, key: string): ApplicationUpdateResult {
    const replay = this.replay(key, command)
    if (replay) return replay
    if (this.requests.size >= 1024) return this.reject("request-limit")
    let result: ApplicationUpdateResult
    if (this.disposed || !this.options.driver) result = this.reject("disabled")
    else if (command === "check" && ["idle", "error", "available"].includes(this.state.phase)) {
      void this.check()
      result = { accepted: true, snapshot: this.snapshot() }
    } else if (command === "download" && this.state.phase === "available") {
      void this.download()
      result = { accepted: true, snapshot: this.snapshot() }
    } else if (command === "install" && this.state.phase === "ready") {
      if (this.options.hasProject()) result = this.reject("project-open")
      else {
        this.update({ phase: "installing" })
        // Return the accepted receipt before irreversible shutdown starts.
        setImmediate(() => {
          void this.install()
        })
        result = { accepted: true, snapshot: this.snapshot() }
      }
    } else result = this.reject("not-ready")
    this.requests.set(key, { command, result })
    return structuredClone(result)
  }

  private async check(): Promise<void> {
    this.nextCheck = Date.now() + 4 * 60 * 60 * 1000
    this.update({ phase: "checking", error: null, progress: 0, availableVersion: null })
    try {
      const version = await this.options.driver!.check()
      this.update({ phase: version ? "available" : "idle", availableVersion: version })
    } catch {
      this.fail("check-failed")
    }
  }

  private async download(): Promise<void> {
    // Lock before awaiting activity; concurrent commands cannot start a second download.
    this.update({ phase: "downloading", error: null })
    try {
      if (!(await this.options.isIdle())) {
        this.update({ phase: "available" })
        return
      }
      if (this.disposed) return
      await this.options.driver!.download((percent) => {
        const progress = Math.max(0, Math.min(100, Math.floor(percent)))
        if (Number.isFinite(progress) && progress !== this.state.progress) this.update({ progress })
      })
      this.update({ phase: "ready", progress: 100 })
    } catch {
      this.fail("download-failed")
    }
  }

  private async install(): Promise<void> {
    if (this.disposed) return
    try {
      if (this.options.hasProject() || !(await this.options.isIdle())) {
        this.update({ phase: "ready" })
        return
      }
      if (!(await this.options.prepareInstall())) {
        this.fail("shutdown-failed", true)
        return
      }
    } catch {
      this.fail("shutdown-failed", true)
      return
    }
    try {
      this.options.driver!.install(() => this.fail("install-failed", true))
    } catch {
      this.fail("install-failed", true)
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearInterval(this.timer)
    this.options.driver?.dispose()
  }
}
