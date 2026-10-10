import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

const electron = vi.hoisted(() => {
  class FakeBaseWindow {
    static instances: FakeBaseWindow[] = []
    static contentWidthAdjustment = 0
    static contentHeightAdjustment = 0
    static toolbarHeightAdjustment = 0
    readonly listeners = new Map<string, (...args: never[]) => void>()
    readonly contentView = { addChildView: vi.fn(), removeChildView: vi.fn() }
    readonly show = vi.fn(() => {
      return undefined
    })
    readonly showInactive = vi.fn(() => {
      return undefined
    })
    readonly hide = vi.fn(() => {
      return undefined
    })
    readonly focus = vi.fn(() => {
      this.focused = true
    })
    readonly destroy = vi.fn(() => {
      this.destroyed = true
    })
    readonly setBounds = vi.fn(
      (bounds: { x: number; y: number; width: number; height: number }) => {
        this.bounds = {
          ...bounds,
          height:
            bounds.height +
            (this.options.frame === false ? FakeBaseWindow.toolbarHeightAdjustment : 0)
        }
      }
    )
    readonly setContentSize = vi.fn((width: number, height: number) => {
      this.contentSize = [
        width + FakeBaseWindow.contentWidthAdjustment,
        height + FakeBaseWindow.contentHeightAdjustment
      ]
    })
    readonly setResizable = vi.fn()
    readonly setMinimumSize = vi.fn()
    readonly options: Record<string, unknown>
    contentTopInset = 29
    private destroyed = false
    private focused = false
    private bounds = { x: 10, y: 20, width: 800, height: 660 }
    private contentSize: [number, number]

    constructor(options: Record<string, unknown> = {}) {
      this.options = options
      this.contentSize = [Number(options.width ?? 800), Number(options.height ?? 660)]
      FakeBaseWindow.instances.push(this)
    }

    on(name: string, listener: (...args: never[]) => void): void {
      this.listeners.set(name, listener)
    }

    emit(name: string, ...args: never[]): void {
      this.listeners.get(name)?.(...args)
    }

    isDestroyed(): boolean {
      return this.destroyed
    }

    isFocused(): boolean {
      return this.focused
    }

    getContentSize(): [number, number] {
      return this.contentSize
    }

    getBounds(): { x: number; y: number; width: number; height: number } {
      return this.bounds
    }

    getContentBounds(): { x: number; y: number; width: number; height: number } {
      return {
        x: this.bounds.x,
        y: this.bounds.y + this.contentTopInset,
        width: this.contentSize[0],
        height: this.contentSize[1]
      }
    }

    getNativeWindowHandle(): Buffer {
      return Buffer.from([1])
    }
  }

  class FakeWebContentsView {
    static instances: FakeWebContentsView[] = []
    readonly listeners = new Map<string, (...args: never[]) => void>()
    private bounds = { x: 0, y: 0, width: 1, height: 1 }
    readonly setBounds = vi.fn((bounds: typeof this.bounds) => {
      this.bounds = bounds
    })
    readonly webContents = {
      close: vi.fn(),
      isDestroyed: vi.fn(() => false),
      loadURL: vi.fn(async () => undefined),
      setWindowOpenHandler: vi.fn(),
      on: vi.fn((name: string, listener: (...args: never[]) => void) => {
        this.listeners.set(name, listener)
      })
    }

    constructor() {
      FakeWebContentsView.instances.push(this)
    }

    getBounds(): typeof this.bounds {
      return this.bounds
    }
  }

  return { FakeBaseWindow, FakeWebContentsView, scaleFactor: 1 }
})

vi.mock("electron", () => ({
  BaseWindow: electron.FakeBaseWindow,
  WebContentsView: electron.FakeWebContentsView,
  screen: {
    getDisplayMatching: () => ({ scaleFactor: electron.scaleFactor })
  }
}))

import {
  ElectronPluginEditorWindows,
  mapParentBeforeNativeAttach,
  nativeExtent,
  type PluginEditorToolbarAction
} from "./audio-host-editor-windows"

async function editorLayoutHarness(constrained = false) {
  const windows = new ElectronPluginEditorWindows()
  let state = {
    activeMode: "native" as "native" | "parameters",
    zoomPercent: 100,
    compareSlot: "a" as const,
    canCompare: false,
    canPaste: false,
    canUndo: false,
    canRedo: false,
    sidechainBuses: [],
    sidechainSources: [],
    sidechainPending: false
  }
  const snapshot = {
    instanceId: "layout-plugin",
    width: 640,
    height: 480,
    displayScale: electron.scaleFactor,
    resizable: !constrained,
    attached: true
  }
  const client = {
    drainEditorHostEvents: vi.fn(
      () =>
        [] as Array<{
          instanceId: string
          width: number
          height: number
          resizable: boolean
        }>
    ),
    editorHostSnapshot: vi.fn(() => snapshot),
    editorToolbarState: vi.fn(() => state),
    focusEditorHost: vi.fn(),
    registerEditorHost: vi.fn(),
    resizeEditorHost: vi.fn(
      (request: { width: number; height: number; displayScale: number; topInset: number }) => {
        if (!constrained) {
          const scale = process.platform === "darwin" ? 1 : request.displayScale
          snapshot.width = Math.round(request.width / scale)
          snapshot.height = Math.round(request.height / scale)
        }
        snapshot.displayScale = request.displayScale
      }
    ),
    unregisterEditorHost: vi.fn()
  }
  const loadParameters = vi.fn(async () => [
    {
      runtimeToken: 7,
      title: "Gain",
      normalized: 0.5,
      units: "dB",
      stepCount: 0,
      readOnly: false,
      hidden: false
    }
  ])
  const open = () =>
    windows.open(
      client as never,
      snapshot.instanceId,
      {
        channelName: "Audio 1",
        channelColor: "#58c6c2",
        pluginName: "Gain",
        theme: "dark",
        locale: "en-US"
      },
      async () => ({ editorMode: state.activeMode, open: true }),
      async (action: PluginEditorToolbarAction) => {
        if (action.type === "mode") state = { ...state, activeMode: action.mode }
        return state
      },
      loadParameters as never,
      async () => undefined,
      async () => undefined
    )
  await open()
  return {
    windows,
    client,
    snapshot,
    open,
    loadParameters,
    setState: (patch: Partial<typeof state>) => {
      state = { ...state, ...patch }
    },
    frame: () => electron.FakeBaseWindow.instances.at(-2)!,
    toolbar: () => electron.FakeBaseWindow.instances.at(-1)!,
    view: () => electron.FakeWebContentsView.instances.at(-1)!,
    flush: async () => {
      for (let i = 0; i < 4; i++) await Promise.resolve()
    }
  }
}

describe("native plug-in editor dimensions", () => {
  beforeEach(() => {
    electron.FakeBaseWindow.instances.length = 0
    electron.FakeWebContentsView.instances.length = 0
    electron.FakeBaseWindow.contentWidthAdjustment = 0
    electron.FakeBaseWindow.contentHeightAdjustment = 0
    electron.FakeBaseWindow.toolbarHeightAdjustment = 0
    electron.scaleFactor = 1
  })

  afterEach(() => vi.restoreAllMocks())

  it("keeps AppKit dimensions in logical points", () => {
    expect(nativeExtent(640, 480, 2, "darwin")).toEqual({ width: 640, height: 480 })
  })

  it("converts Electron logical pixels to Win32 and X11 pixels", () => {
    expect(nativeExtent(640, 480, 1.5, "win32")).toEqual({ width: 960, height: 720 })
    expect(nativeExtent(640, 480, 2, "linux")).toEqual({ width: 1280, height: 960 })
  })

  it("never registers an empty native child surface", () => {
    expect(nativeExtent(0, 0, 0, "linux")).toEqual({ width: 1, height: 1 })
  })

  it("maps the X11 parent before attaching a native plug-in view", () => {
    expect(mapParentBeforeNativeAttach("linux")).toBe(true)
    expect(mapParentBeforeNativeAttach("darwin")).toBe(false)
    expect(mapParentBeforeNativeAttach("win32")).toBe(false)
  })

  it("moves the toolbar without resizing the native editor on the same display", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32")
    const host = await editorLayoutHarness()
    host.client.resizeEditorHost.mockClear()
    host.toolbar().setBounds.mockClear()
    host.view().setBounds.mockClear()

    for (const [x, y] of [
      [20, 30],
      [40, 50],
      [60, 70]
    ]) {
      host.frame().setBounds({ ...host.frame().getBounds(), x: x!, y: y! })
      host.frame().emit("move")
    }

    expect(host.client.resizeEditorHost).not.toHaveBeenCalled()
    expect(host.toolbar().setBounds).toHaveBeenCalledTimes(3)
    expect(host.toolbar().getBounds()).toEqual({ x: 60, y: 99, width: 640, height: 60 })
    expect(host.view().setBounds).not.toHaveBeenCalled()
    await host.windows.closeAll()
  })

  it("synchronizes native size, display scale and toolbar inset when geometry changes", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32")
    const host = await editorLayoutHarness()
    host.client.resizeEditorHost.mockClear()
    host.frame().setContentSize(700, 560)
    host.frame().emit("resize")
    expect(host.client.resizeEditorHost).toHaveBeenLastCalledWith(
      expect.objectContaining({
        width: 700,
        height: 500,
        topInset: 60,
        displayScale: 1
      })
    )

    host.client.resizeEditorHost.mockClear()
    electron.scaleFactor = 1.5
    host.frame().emit("move")
    expect(host.client.resizeEditorHost).toHaveBeenCalledOnce()
    expect(host.client.resizeEditorHost).toHaveBeenLastCalledWith(
      expect.objectContaining({
        width: 1050,
        height: 750,
        topInset: 90,
        displayScale: 1.5
      })
    )

    host.client.resizeEditorHost.mockClear()
    host.frame().setContentSize(500, 596)
    host.frame().emit("resize")
    expect(host.client.resizeEditorHost).toHaveBeenCalledOnce()
    expect(host.client.resizeEditorHost).toHaveBeenLastCalledWith(
      expect.objectContaining({
        width: 750,
        height: 750,
        topInset: 144,
        displayScale: 1.5
      })
    )
    expect(host.toolbar().getBounds().height).toBe(96)
    await host.windows.closeAll()
  })

  it("synchronizes a changed X11 parent chrome inset even without a content resize", async () => {
    vi.useFakeTimers()
    vi.spyOn(process, "platform", "get").mockReturnValue("linux")
    const host = await editorLayoutHarness()
    try {
      await vi.runAllTimersAsync()
      host.client.resizeEditorHost.mockClear()
      host.frame().contentTopInset = 31
      host.frame().emit("move")
      expect(host.client.resizeEditorHost).toHaveBeenCalledOnce()
      expect(host.client.resizeEditorHost).toHaveBeenLastCalledWith(
        expect.objectContaining({ topInset: 91 })
      )
      await host.windows.closeAll()
      await vi.runAllTimersAsync()
    } finally {
      vi.useRealTimers()
    }
  })

  it("preserves a real one-pixel plugin resize at 100% DPI", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32")
    const host = await editorLayoutHarness()
    host.client.resizeEditorHost.mockClear()
    host.frame().setContentSize.mockClear()
    host.snapshot.width = 641
    host.client.drainEditorHostEvents.mockReturnValueOnce([
      {
        instanceId: host.snapshot.instanceId,
        width: 641,
        height: 480,
        resizable: true
      }
    ])

    host.windows.drain(host.client as never)
    await host.flush()
    expect(host.frame().setContentSize).toHaveBeenCalledWith(641, 540)
    expect(host.frame().getContentSize()).toEqual([641, 540])
    expect(host.client.resizeEditorHost).toHaveBeenLastCalledWith(
      expect.objectContaining({ width: 641, height: 480 })
    )
    host.client.resizeEditorHost.mockClear()
    host.frame().setContentSize.mockClear()
    for (let i = 0; i < 24; i++) host.windows.drain(host.client as never)
    expect(host.frame().setContentSize).not.toHaveBeenCalled()
    expect(host.client.resizeEditorHost).not.toHaveBeenCalled()
    await host.windows.closeAll()
  })

  it("does not reapply unchanged toolbar or native geometry while draining state", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32")
    const host = await editorLayoutHarness()
    host.client.resizeEditorHost.mockClear()
    host.frame().setContentSize.mockClear()
    host.toolbar().setBounds.mockClear()
    host.view().setBounds.mockClear()

    for (let i = 0; i < 24; i++) host.windows.drain(host.client as never)
    host.client.drainEditorHostEvents.mockReturnValue([
      {
        instanceId: host.snapshot.instanceId,
        width: 640,
        height: 480,
        resizable: true
      }
    ])
    for (let i = 0; i < 8; i++) host.windows.drain(host.client as never)

    expect(host.toolbar().setBounds).not.toHaveBeenCalled()
    expect(host.view().setBounds).not.toHaveBeenCalled()
    expect(host.frame().setContentSize).not.toHaveBeenCalled()
    expect(host.client.resizeEditorHost).not.toHaveBeenCalled()
    await host.windows.closeAll()
  })

  it("reconciles native geometry after parameter mode, zoom and showing an existing editor", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32")
    const host = await editorLayoutHarness()
    host.client.resizeEditorHost.mockClear()
    host.setState({ activeMode: "parameters" })
    host.windows.drain(host.client as never)
    await host.flush()
    host.windows.drain(host.client as never)
    expect(host.loadParameters).toHaveBeenCalledOnce()
    expect(host.client.resizeEditorHost).not.toHaveBeenCalled()
    expect(host.toolbar().getBounds()).toEqual(expect.objectContaining({ width: 720, height: 700 }))

    host.setState({ activeMode: "native" })
    host.windows.drain(host.client as never)
    await host.flush()
    expect(host.client.resizeEditorHost).toHaveBeenLastCalledWith(
      expect.objectContaining({ width: 640, height: 480 })
    )
    expect(host.frame().getContentSize()).toEqual([640, 540])

    host.client.resizeEditorHost.mockClear()
    host.snapshot.width = 800
    host.snapshot.height = 600
    host.setState({ zoomPercent: 125 })
    host.windows.drain(host.client as never)
    await host.flush()
    expect(host.client.resizeEditorHost).toHaveBeenLastCalledWith(
      expect.objectContaining({ width: 800, height: 600 })
    )
    expect(host.frame().getContentSize()).toEqual([800, 660])

    host.frame().hide()
    host.client.resizeEditorHost.mockClear()
    await host.open()
    expect(host.client.resizeEditorHost).toHaveBeenCalled()
    expect(host.frame().show).toHaveBeenCalled()
    await host.windows.closeAll()
  })

  it("starts fresh layout state when an externally closed or retired host reopens", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32")
    const host = await editorLayoutHarness()
    const first = host.frame()
    host.windows.hostClosed(host.snapshot.instanceId)
    expect(first.destroy).toHaveBeenCalledOnce()
    host.client.resizeEditorHost.mockClear()
    await host.open()
    expect(host.frame()).not.toBe(first)
    expect(host.client.registerEditorHost).toHaveBeenCalledTimes(2)
    expect(host.client.resizeEditorHost).toHaveBeenCalled()
    expect(host.toolbar().setBounds).toHaveBeenCalled()

    const second = host.frame()
    await host.windows.close(host.snapshot.instanceId)
    host.client.resizeEditorHost.mockClear()
    host.windows.drain(host.client as never)
    expect(host.client.resizeEditorHost).not.toHaveBeenCalled()
    await host.open()
    expect(host.frame()).not.toBe(second)
    expect(host.client.registerEditorHost).toHaveBeenCalledTimes(3)
    expect(host.client.resizeEditorHost).toHaveBeenCalled()
    await host.windows.closeAll()
  })

  it("does not chase one-DIP content and toolbar readback rounding at 2x DPI", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32")
    electron.scaleFactor = 2
    electron.FakeBaseWindow.contentWidthAdjustment = 1
    electron.FakeBaseWindow.contentHeightAdjustment = 1
    electron.FakeBaseWindow.toolbarHeightAdjustment = 1
    const host = await editorLayoutHarness(true)
    expect(host.frame().getContentSize()).toEqual([641, 541])
    expect(host.toolbar().getBounds().width).toBe(641)
    expect(host.toolbar().getBounds().height).toBe(61)
    host.client.resizeEditorHost.mockClear()
    host.frame().setContentSize.mockClear()
    host.toolbar().setBounds.mockClear()
    host.client.drainEditorHostEvents.mockReturnValue([
      {
        instanceId: host.snapshot.instanceId,
        width: 640,
        height: 480,
        resizable: false
      }
    ])

    for (let i = 1; i <= 12; i++) {
      host.frame().setBounds({ ...host.frame().getBounds(), x: 10 + i, y: 20 + i })
      host.frame().emit("move")
      host.windows.drain(host.client as never)
      host.windows.drain(host.client as never)
    }

    expect(host.frame().setContentSize).not.toHaveBeenCalled()
    expect(host.client.resizeEditorHost).not.toHaveBeenCalled()
    expect(host.toolbar().setBounds).toHaveBeenCalledTimes(12)
    expect(host.toolbar().setBounds.mock.calls.map(([bounds]) => bounds.width)).toEqual(
      Array(12).fill(641)
    )
    expect(host.frame().getContentSize()).toEqual([641, 541])
    expect(host.snapshot).toEqual(expect.objectContaining({ width: 640, height: 480 }))
    await host.windows.closeAll()
  })

  it("does not recursively reconcile a constrained snapshot while applying it", () => {
    const windows = new ElectronPluginEditorWindows()
    const accepted = {
      instanceId: "plugin-1",
      width: 640,
      height: 480,
      displayScale: 1.5,
      resizable: true,
      attached: true
    }
    const editorHostSnapshot = vi.fn(() => accepted)
    const resizeEditorHost = vi.fn()
    const entry = {
      window: {
        isDestroyed: () => false,
        setResizable: vi.fn(),
        getContentSize: () => [800, 660],
        setContentSize: vi.fn(),
        getContentBounds: () => ({ x: 10, y: 20, width: 800, height: 660 }),
        getBounds: () => ({ x: 10, y: 20, width: 800, height: 660 })
      },
      toolbarWindow: {
        isDestroyed: () => false,
        setBounds: vi.fn()
      },
      toolbar: { setBounds: vi.fn() },
      client: { resizeEditorHost, editorHostSnapshot },
      applyingPluginSize: false,
      toolbarState: { activeMode: "native" },
      minimumNativeWidth: 1,
      minimumNativeHeight: 1
    }
    type SnapshotHarness = {
      applySnapshot(target: unknown, snapshot: typeof accepted): void
    }
    const harness = windows as unknown as SnapshotHarness

    harness.applySnapshot(entry, accepted)

    expect(resizeEditorHost).toHaveBeenCalledOnce()
    expect(editorHostSnapshot).not.toHaveBeenCalled()
    expect(entry.applyingPluginSize).toBe(false)
  })

  it("does not steal focus from an open toolbar control during state refresh", async () => {
    const windows = new ElectronPluginEditorWindows()
    const state = {
      activeMode: "native",
      zoomPercent: 100,
      compareSlot: "a",
      canCompare: true,
      canPaste: false,
      canUndo: false,
      canRedo: false,
      sidechainBuses: [],
      sidechainSources: [],
      sidechainPending: false
    }
    const focusEditorHost = vi.fn()
    const entry = {
      window: {
        isDestroyed: () => false,
        getContentSize: () => [800, 660],
        getBounds: () => ({ x: 10, y: 20, width: 800, height: 660 }),
        getContentBounds: () => ({ x: 10, y: 20, width: 800, height: 660 })
      },
      toolbarWindow: {
        isDestroyed: () => false,
        setBounds: vi.fn()
      },
      toolbar: {
        setBounds: vi.fn(),
        webContents: {
          isDestroyed: () => false,
          loadURL: vi.fn()
        }
      },
      client: { focusEditorHost },
      closing: false,
      context: {
        channelName: "Audio 1",
        channelColor: "#58c6c2",
        pluginName: "Compressor",
        theme: "dark",
        locale: "en-US"
      },
      toolbarState: state,
      parameters: [],
      loadingParameters: false,
      toolbarKey: "",
      minimumNativeWidth: 1,
      minimumNativeHeight: 1
    }
    type ToolbarHarness = {
      applyToolbarState(instanceId: string, target: unknown, next: typeof state): Promise<void>
    }
    const harness = windows as unknown as ToolbarHarness

    await harness.applyToolbarState("plugin-1", entry, state)

    expect(focusEditorHost).not.toHaveBeenCalled()
  })

  it("applies the native snapshot immediately after leaving parameter mode", async () => {
    vi.useFakeTimers()
    const platform = vi.spyOn(process, "platform", "get").mockReturnValue("linux")
    const windows = new ElectronPluginEditorWindows()
    const state = {
      activeMode: "native",
      zoomPercent: 100,
      compareSlot: "a",
      canCompare: true,
      canPaste: false,
      canUndo: false,
      canRedo: false,
      sidechainBuses: [],
      sidechainSources: [],
      sidechainPending: false
    }
    const snapshot = {
      instanceId: "plugin-1",
      width: 640,
      height: 480,
      displayScale: 1,
      resizable: false,
      attached: true
    }
    const setContentSize = vi.fn()
    const resizeEditorHost = vi.fn()
    const focusEditorHost = vi.fn()
    const entry = {
      window: {
        isDestroyed: () => false,
        getContentSize: () => [720, 700],
        setContentSize,
        setMinimumSize: vi.fn(),
        setResizable: vi.fn(),
        getContentBounds: () => ({ x: 10, y: 49, width: 720, height: 700 }),
        getBounds: () => ({ x: 10, y: 20, width: 720, height: 700 })
      },
      toolbarWindow: {
        isDestroyed: () => false,
        setBounds: vi.fn()
      },
      toolbar: {
        setBounds: vi.fn(),
        webContents: {
          isDestroyed: () => false,
          loadURL: vi.fn()
        }
      },
      client: {
        editorHostSnapshot: vi.fn(() => snapshot),
        resizeEditorHost,
        focusEditorHost
      },
      closing: false,
      applyingPluginSize: false,
      context: {
        channelName: "Audio 1",
        channelColor: "#58c6c2",
        pluginName: "Compressor",
        theme: "dark",
        locale: "en-US"
      },
      toolbarState: { ...state, activeMode: "parameters" },
      parameters: [],
      loadingParameters: false,
      toolbarKey: "",
      minimumNativeWidth: 1,
      minimumNativeHeight: 1
    }
    type ToolbarHarness = {
      entries: Map<string, unknown>
      applyToolbarState(instanceId: string, target: unknown, next: typeof state): Promise<void>
    }
    const harness = windows as unknown as ToolbarHarness
    harness.entries.set("plugin-1", entry)

    try {
      await harness.applyToolbarState("plugin-1", entry, state)

      expect(setContentSize).toHaveBeenCalledWith(640, 540)
      expect(resizeEditorHost).toHaveBeenCalledOnce()
      expect(resizeEditorHost).toHaveBeenCalledWith(expect.objectContaining({ topInset: 89 }))
      expect(focusEditorHost).toHaveBeenCalledWith("plugin-1")

      await vi.runAllTimersAsync()
      expect(resizeEditorHost).toHaveBeenCalledTimes(3)
    } finally {
      platform.mockRestore()
      vi.useRealTimers()
    }
  })

  it("owns a native editor through actions, refreshes, and cleanup", async () => {
    vi.useFakeTimers()
    const platform = vi.spyOn(process, "platform", "get").mockReturnValue("linux")
    const parent = new electron.FakeBaseWindow()
    const windows = new ElectronPluginEditorWindows()
    const nativeState = {
      activeMode: "native" as const,
      zoomPercent: 100,
      compareSlot: "a" as const,
      canCompare: true,
      canPaste: true,
      canUndo: true,
      canRedo: false,
      sidechainBuses: [{ inputPortKey: "aux-1", name: "Side <1>", sourceChannelId: "source-1" }],
      sidechainSources: [
        { id: "source-1", name: "Audio & One", kind: "audio" as const },
        { id: "source-2", name: "Instrument", kind: "instrument" as const }
      ],
      sidechainPending: false
    }
    const parameterState = { ...nativeState, activeMode: "parameters" as const }
    let toolbarState: typeof nativeState | typeof parameterState = nativeState
    const snapshot = {
      instanceId: "plugin-1",
      width: 640,
      height: 480,
      displayScale: 1.5,
      resizable: true,
      attached: true
    }
    const client = {
      drainEditorHostEvents: vi.fn(() => []),
      editorHostSnapshot: vi.fn(() => snapshot),
      editorToolbarState: vi.fn(() => toolbarState),
      focusEditorHost: vi.fn(),
      registerEditorHost: vi.fn(),
      resizeEditorHost: vi.fn(),
      unregisterEditorHost: vi.fn()
    }
    const openNative = vi.fn(async () => ({ editorMode: "native" as const, open: true }))
    const applyAction = vi.fn(async (action: { type: string }) => {
      toolbarState = action.type === "mode" ? parameterState : nativeState
      return toolbarState
    })
    const loadParameters = vi.fn(async () => [
      {
        runtimeToken: 7,
        title: "Gain <Main>",
        units: "dB",
        stepCount: 10,
        normalized: 0.5,
        formatted: "-6",
        readOnly: false
      }
    ])
    const setParameter = vi.fn(async () => undefined)
    const closeNative = vi.fn(async () => undefined)

    try {
      await expect(
        windows.open(
          client as never,
          "plugin-1",
          {
            channelName: "Audio & 1",
            channelColor: "invalid",
            pluginName: "Compressor",
            theme: "light",
            locale: "zh-cmn-Hans-CN"
          },
          openNative,
          applyAction as never,
          loadParameters as never,
          setParameter,
          closeNative
        )
      ).resolves.toEqual({ editorMode: "native", open: true })

      const editorWindow = electron.FakeBaseWindow.instances[1]!
      const toolbarWindow = electron.FakeBaseWindow.instances[2]!
      const toolbar = electron.FakeWebContentsView.instances[0]!
      expect(editorWindow.options.parent).toBeUndefined()
      expect(toolbarWindow.options.parent).toBe(editorWindow)
      expect(parent.focus).not.toHaveBeenCalled()
      expect(client.registerEditorHost).toHaveBeenCalledWith(
        expect.objectContaining({ instanceId: "plugin-1", width: 800, displayScale: 1 })
      )
      expect(toolbar.webContents.loadURL).toHaveBeenCalledWith(
        expect.stringContaining("data:text/html")
      )
      expect(toolbarWindow.showInactive).toHaveBeenCalled()

      const navigate = toolbar.listeners.get("will-navigate")!
      const preventDefault = vi.fn()
      navigate({ preventDefault } as never, "https://example.test" as never)
      expect(preventDefault).not.toHaveBeenCalled()
      navigate({ preventDefault } as never, "heron-editor-action:mode-parameters" as never)
      await vi.runAllTimersAsync()
      expect(applyAction).toHaveBeenCalledWith({ type: "mode", mode: "parameters" })
      expect(loadParameters).toHaveBeenCalled()

      navigate({ preventDefault } as never, "heron-editor-action:parameter-perform-7-1.5" as never)
      navigate({ preventDefault } as never, "heron-editor-action:parameter-end-7-0.25" as never)
      await vi.runAllTimersAsync()
      expect(setParameter).toHaveBeenCalledWith(7, 1, "perform")
      expect(setParameter).toHaveBeenCalledWith(7, 0.25, "end")

      toolbarState = nativeState
      client.drainEditorHostEvents.mockReturnValueOnce([
        { instanceId: "plugin-1", width: 700, height: 500, resizable: false }
      ] as never)
      windows.drain(client as never)
      editorWindow.emit("resize")
      editorWindow.emit("move")
      editorWindow.emit("focus")
      await vi.runAllTimersAsync()
      expect(client.resizeEditorHost).toHaveBeenCalled()

      await expect(
        windows.open(
          client as never,
          "plugin-1",
          {
            channelName: "",
            channelColor: "#58c6c2",
            pluginName: "Compressor",
            theme: "dark",
            locale: "en-US"
          },
          openNative,
          applyAction as never,
          loadParameters as never,
          setParameter,
          closeNative
        )
      ).resolves.toEqual({ editorMode: "native", open: true })
      expect(editorWindow.show).toHaveBeenCalled()

      await expect(windows.close("missing")).resolves.toBe(false)
      await expect(windows.close("plugin-1")).resolves.toBe(true)
      expect(closeNative).toHaveBeenCalledOnce()
      expect(client.unregisterEditorHost).toHaveBeenCalledWith("plugin-1")
      expect(toolbarWindow.destroy).toHaveBeenCalled()
      expect(editorWindow.destroy).toHaveBeenCalled()
      await expect(windows.close("plugin-1")).resolves.toBe(false)
    } finally {
      platform.mockRestore()
      vi.useRealTimers()
    }
  })

  it("cleans up failed opens and externally closed hosts", async () => {
    const windows = new ElectronPluginEditorWindows()
    const client = {
      drainEditorHostEvents: vi.fn(() => []),
      editorHostSnapshot: vi.fn(() => null),
      editorToolbarState: vi.fn(() => null),
      focusEditorHost: vi.fn(),
      registerEditorHost: vi.fn(),
      resizeEditorHost: vi.fn(),
      unregisterEditorHost: vi.fn()
    }
    const context = {
      channelName: "Audio 1",
      channelColor: "#58c6c2",
      pluginName: "Broken",
      theme: "dark" as const,
      locale: "en-US" as const
    }
    const noAction = vi.fn()

    await expect(
      windows.open(
        client as never,
        "broken",
        context,
        async () => {
          throw new Error("attach failed")
        },
        noAction,
        async () => [],
        async () => undefined,
        async () => undefined
      )
    ).rejects.toThrow("attach failed")
    expect(client.unregisterEditorHost).toHaveBeenCalledWith("broken")

    await windows.open(
      client as never,
      "host-closed",
      context,
      async () => ({ editorMode: "parameters", open: true }),
      noAction,
      async () => [],
      async () => undefined,
      async () => undefined
    )
    windows.hostClosed("missing")
    windows.hostClosed("host-closed")
    expect(client.unregisterEditorHost).toHaveBeenCalledWith("host-closed")
    await expect(windows.closeAll()).resolves.toBeUndefined()
  })

  it("does not reactivate an editor when close wins an outstanding open or reopen", async () => {
    const windows = new ElectronPluginEditorWindows()
    const client = {
      editorHostSnapshot: vi.fn(() => null),
      editorToolbarState: vi.fn(() => null),
      focusEditorHost: vi.fn(),
      registerEditorHost: vi.fn(),
      resizeEditorHost: vi.fn(),
      unregisterEditorHost: vi.fn()
    }
    const opening = deferred<{ editorMode: "native"; open: boolean }>()
    const closing = deferred<void>()
    const openNative = vi.fn(() => opening.promise)
    const closeNative = vi.fn(() => closing.promise)
    const open = () =>
      windows.open(
        client as never,
        "analysis-plugin",
        {
          channelName: "Analysis",
          channelColor: "#58c6c2",
          pluginName: "Gain",
          theme: "dark",
          locale: "en-US"
        },
        openNative,
        vi.fn(),
        async () => [],
        async () => undefined,
        closeNative
      )
    const pending = open()
    const editor = electron.FakeBaseWindow.instances[0]!
    const toolbarWindow = electron.FakeBaseWindow.instances[1]!
    const closed = windows.close("analysis-plugin")
    editor.show.mockClear()
    await expect(open()).resolves.toEqual({ editorMode: "native", open: false })
    opening.resolve({ editorMode: "native", open: true })
    await expect(pending).resolves.toEqual({ editorMode: "native", open: false })
    expect(openNative).toHaveBeenCalledOnce()
    expect(editor.show).not.toHaveBeenCalled()
    expect(editor.focus).not.toHaveBeenCalled()
    expect(client.focusEditorHost).not.toHaveBeenCalled()
    closing.resolve()
    await expect(closed).resolves.toBe(true)
    expect(toolbarWindow.destroy).toHaveBeenCalledOnce()
    expect(editor.destroy).toHaveBeenCalledOnce()
    expect(electron.FakeWebContentsView.instances[0]!.webContents.close).toHaveBeenCalledOnce()
    expect(client.unregisterEditorHost).toHaveBeenCalledOnce()

    // A later explicit open gets a fresh host instead of retaining the retired window.
    await expect(open()).resolves.toEqual({ editorMode: "native", open: true })
    expect(electron.FakeBaseWindow.instances).toHaveLength(4)
    const reopening = deferred<{ editorMode: "native"; open: boolean }>()
    openNative.mockReturnValueOnce(reopening.promise)
    const reopened = open()
    await windows.close("analysis-plugin")
    reopening.resolve({ editorMode: "native", open: true })
    await expect(reopened).resolves.toEqual({ editorMode: "native", open: false })
    expect(client.unregisterEditorHost).toHaveBeenCalledTimes(2)
  })

  it("does not focus a retired host after its parameter view finishes loading", async () => {
    const windows = new ElectronPluginEditorWindows()
    const parameters = deferred<[]>()
    const loadParameters = vi.fn(() => parameters.promise)
    const client = {
      editorHostSnapshot: vi.fn(() => null),
      editorToolbarState: vi.fn(() => ({ activeMode: "parameters" })),
      focusEditorHost: vi.fn(),
      registerEditorHost: vi.fn(),
      resizeEditorHost: vi.fn(),
      unregisterEditorHost: vi.fn()
    }
    const open = () =>
      windows.open(
        client as never,
        "analysis-parameters",
        {
          channelName: "Analysis",
          channelColor: "#58c6c2",
          pluginName: "Gain",
          theme: "dark",
          locale: "en-US"
        },
        async () => ({ editorMode: "parameters", open: true }),
        vi.fn(),
        loadParameters,
        async () => undefined,
        async () => undefined
      )
    const opened = open()
    await vi.waitFor(() => expect(loadParameters).toHaveBeenCalledOnce())
    const closed = windows.close("analysis-parameters")
    await expect(open()).resolves.toEqual({ editorMode: "parameters", open: false })
    await closed
    parameters.resolve([])
    await expect(opened).resolves.toEqual({ editorMode: "parameters", open: false })
    expect(client.editorHostSnapshot).not.toHaveBeenCalled()
    expect(client.focusEditorHost).not.toHaveBeenCalled()
    expect(electron.FakeBaseWindow.instances[0]!.focus).not.toHaveBeenCalled()
    expect(client.unregisterEditorHost).toHaveBeenCalledOnce()
  })
})
