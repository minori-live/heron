import { createPinia, setActivePinia } from "pinia"
import { DOMWrapper, flushPromises, mount, shallowMount } from "@vue/test-utils"
import { describe, expect, it, vi } from "vitest"
import type { MixerChannelState, TempoMapSnapshot } from "@heron/contracts"
import type { ProjectAssetSummary as Asset } from "@heron/contracts"
import { useProjectStore } from "../../stores/project"
import { useMixerStore } from "../../stores/mixer"
import { useArrangementViewStore } from "../../stores/arrangementView"
import { useMidiImportStore } from "../../stores/midiImport"
import { useTransportStore } from "../../stores/transport"
import { PROJECT_MEDIA_DRAG_TYPE } from "../../utils/mediaDrag"
import ArrangementWorkspace from "./ArrangementWorkspace.vue"
import ArrangementTrack from "./ArrangementTrack.vue"
import ArrangementTimelineTrack from "./ArrangementTimelineTrack.vue"
import ArrangementTimelineTrackSource from "./ArrangementTimelineTrack.vue?raw"
import ArrangementTrackRail from "./ArrangementTrackRail.vue"
import ArrangementTrackRailSource from "./ArrangementTrackRail.vue?raw"
import InlineTrackNameEditor from "../InlineTrackNameEditor.vue"
import MidiArrangementTrack from "./MidiArrangementTrack.vue"
import TrackQuickControls from "./TrackQuickControls.vue"
import type { ArrangementTrackRow } from "./arrangementWorkspaceTypes"

const recordingAsset: Asset = {
  id: "recording-1",
  name: "First take.bwf",
  kind: "audio",
  contentHash: "recording-1-hash",
  sampleRate: 48_000,
  channels: 2,
  bitDepth: "float32",
  frameCount: 48_000n
}

const midiAsset: Asset = {
  id: "midi-1",
  name: "Bass.mid",
  kind: "midi",
  contentHash: "midi-1-hash",
  byteLength: 128
}

describe("ArrangementWorkspace rendering", () => {
  it("renders project audio as a selectable timeline clip", async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const project = useProjectStore()
    project.applyLifecycleState({
      status: "open",
      session: {
        id: "project",
        path: "project.heron",
        configuration: {
          name: "Session",
          sampleRate: 48_000,
          timeSignatureNumerator: 4,
          timeSignatureDenominator: 4,
          waveformDisplayMode: "separate"
        },
        dirty: true,
        recoveredWorkingCopy: false
      },
      error: null
    })
    project.projectAssets = [recordingAsset]
    const mixer = useMixerStore()
    mixer.graph = {
      sampleRate: 48_000,
      tracks: [
        { id: "track:audio-1", channelId: "audio-1", sortOrder: 0 },
        { id: "track:audio-2", channelId: "audio-2", sortOrder: 1 }
      ],
      channels: [
        {
          id: "audio-1",
          kind: "audio",
          systemRole: null,
          name: "Audio 1",
          color: "#8C83FF",
          sortOrder: 0,
          inputSource: "hardware",
          inputFormat: "stereo",
          gainDb: 0,
          pan: 0,
          muted: false,
          soloed: false,
          outputChannelId: "output",
          recordArmed: false,
          inputMonitoring: false,
          inputChannels: [1, 2],
          hardwareOutputChannels: []
        },
        {
          id: "audio-2",
          kind: "audio",
          systemRole: null,
          name: "Audio 2",
          color: "#67D9E7",
          sortOrder: 1,
          inputSource: "hardware",
          inputFormat: "mono",
          gainDb: 0,
          pan: 0,
          muted: false,
          soloed: false,
          outputChannelId: "output",
          recordArmed: false,
          inputMonitoring: false,
          inputChannels: [1],
          hardwareOutputChannels: []
        },
        {
          id: "master",
          kind: "master",
          systemRole: null,
          name: "Master",
          color: "#67D9E7",
          sortOrder: 0,
          inputSource: null,
          inputFormat: null,
          gainDb: 0,
          pan: 0,
          muted: false,
          soloed: false,
          outputChannelId: null,
          recordArmed: false,
          inputMonitoring: false,
          inputChannels: [],
          hardwareOutputChannels: []
        },
        {
          id: "output",
          kind: "output",
          systemRole: null,
          name: "Output 1–2",
          color: "#73D6A2",
          sortOrder: 0,
          inputSource: null,
          inputFormat: null,
          gainDb: 0,
          pan: 0,
          muted: false,
          soloed: false,
          outputChannelId: null,
          recordArmed: false,
          inputMonitoring: false,
          inputChannels: [],
          hardwareOutputChannels: [1, 2]
        }
      ],
      audioClips: [
        {
          id: recordingAsset.id,
          assetId: recordingAsset.id,
          trackId: "track:audio-1",
          name: "First take",
          startFrame: 0,
          sourceOffsetFrames: 0,
          sourceLengthFrames: Number.MAX_SAFE_INTEGER,
          fadeInFrames: 0,
          fadeOutFrames: 0,
          lengthFrames: 48_000,
          assetSampleRate: 48_000,
          assetChannels: 2
        }
      ],
      sends: [],
      plugins: [],
      midiClips: [],
      keySignatureEvents: [{ tick: 0, fifths: 0, mode: "major" }],
      tempoMap: {
        ticksPerQuarter: 960,
        tempoEvents: [{ tick: 0, beatsPerMinute: 120 }],
        timeSignatureEvents: [{ tick: 0, numerator: 4, denominator: 4 }]
      }
    }
    const wrapper = mount(ArrangementWorkspace, {
      props: {
        recordingId: null,
        recordingStartedAt: null,
        recordingStartFrame: null,
        recordingError: ""
      },
      global: { plugins: [pinia] }
    })

    expect(wrapper.findAll(".track-lane")).toHaveLength(2)
    expect(wrapper.get('button[aria-label="Hide global tracks"]').attributes("aria-pressed")).toBe(
      "true"
    )
    expect(wrapper.findAll('[data-testid="timeline-playhead"]')).toHaveLength(1)
    expect(wrapper.get('[aria-label="Tempo global track"]').text()).toContain("Tempo")
    expect(wrapper.get('[aria-label="Meter global track"]').text()).toContain("Meter")
    expect(wrapper.get('[aria-label="Key global track"]').text()).toContain("Key")
    const keySelect = wrapper.get<HTMLButtonElement>('[aria-label="Selected Key signature"]')
    expect(keySelect.text()).toBe("C Major")
    const executeKeyChange = vi.spyOn(mixer, "execute").mockResolvedValue(true)
    await keySelect.trigger("click")
    const keyGroups = document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')
    expect([...keyGroups].map((group) => group.textContent?.trim())).toEqual([
      "Major keys",
      "Minor keys"
    ])
    const majorKeys = new DOMWrapper(keyGroups[0])
    await majorKeys.trigger("focus")
    await majorKeys.trigger("keydown", { key: "ArrowRight" })
    const keyOptions = [...document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
    expect(keyOptions).toHaveLength(15)
    expect(keyOptions[0]?.textContent?.trim()).toBe("C♯ Major")
    expect(keyOptions[14]?.textContent?.trim()).toBe("C♭ Major")
    await new DOMWrapper(keyOptions[14]).trigger("click")
    expect(executeKeyChange).toHaveBeenCalledWith({
      type: "replace-key-signature-map",
      events: [{ tick: 0, fifths: -7, mode: "major" }]
    })
    const clip = wrapper.get('[role="button"][aria-label="Audio clip First take"]')
    expect(clip.attributes("aria-pressed")).toBe("false")
    expect(clip.attributes("style")).toContain("width: 100px")
    mixer.graph = {
      ...mixer.graph,
      tempoMap: {
        ...mixer.graph.tempoMap,
        tempoEvents: [{ tick: 0, beatsPerMinute: 180 }]
      }
    }
    await wrapper.vm.$nextTick()
    expect(clip.attributes("style")).toContain("width: 150px")
    await clip.trigger("click")
    expect(clip.attributes("aria-pressed")).toBe("true")
    expect(wrapper.text()).toContain("First take")

    const arrangementView = useArrangementViewStore()
    await wrapper.get('button[aria-label="Hide global tracks"]').trigger("click")
    expect(arrangementView.globalTracksExpanded).toBe(false)
    expect(wrapper.find('[aria-label="Tempo global track"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Meter global track"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Key global track"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label^="Tempo global track editor"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label^="Meter global track editor"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label^="Key global track editor"]').exists()).toBe(false)
    const globalTracksButton = wrapper.get('button[aria-label="Show global tracks"]')
    expect(globalTracksButton.attributes("aria-pressed")).toBe("false")
    await globalTracksButton.trigger("click")
    expect(arrangementView.globalTracksExpanded).toBe(true)
    expect(wrapper.find('[aria-label="Tempo global track"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Meter global track"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Key global track"]').exists()).toBe(true)
    const resizeHandles = wrapper.findAll('.track-height-resize-handle[role="separator"]')
    expect(resizeHandles).toHaveLength(2)
    expect(wrapper.findAll<HTMLElement>(".track-lane")[0]?.element.style.height).toBe("104px")
    expect(wrapper.findAll<HTMLElement>(".track-lane")[1]?.element.style.height).toBe("104px")

    await resizeHandles[0]?.trigger("keydown", { key: "ArrowDown" })
    expect(arrangementView.trackScale("track:audio-1")).toBe(1.25)
    expect(wrapper.findAll<HTMLElement>(".track-lane")[0]?.element.style.height).toBe("130px")

    arrangementView.zoomTrack(1)
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll<HTMLElement>(".track-lane")[0]?.element.style.height).toBe("150px")
    expect(wrapper.findAll<HTMLElement>(".track-lane")[1]?.element.style.height).toBe("120px")

    await resizeHandles[0]?.trigger("dblclick")
    expect(arrangementView.trackScale("track:audio-1")).toBe(1)
    expect(wrapper.findAll<HTMLElement>(".track-lane")[0]?.element.style.height).toBe("120px")

    const updateChannel = vi.spyOn(mixer, "updateChannel").mockResolvedValue(true)
    await wrapper
      .get('button[aria-label="Audio 1; double-click to rename; Alt+Arrow Up or Down to reorder"]')
      .trigger("dblclick")
    const nameEditor = wrapper.get('input[aria-label="Rename Audio 1"]')
    await nameEditor.setValue("  Rhythm Guitar  ")
    await nameEditor.trigger("blur")
    expect(updateChannel).toHaveBeenCalledWith("audio-1", { name: "Rhythm Guitar" })

    const audioLane = wrapper.get('[data-track-id="track:audio-1"]')
    const projectAudioTransfer = {
      files: [],
      types: [PROJECT_MEDIA_DRAG_TYPE],
      getData: vi.fn(() =>
        JSON.stringify({ assetId: recordingAsset.id, kind: recordingAsset.kind })
      )
    } as unknown as DataTransfer
    await audioLane.trigger("dragover", { dataTransfer: projectAudioTransfer, clientX: 100 })
    await audioLane.trigger("drop", { dataTransfer: projectAudioTransfer, clientX: 100 })
    await flushPromises()
    expect(executeKeyChange).toHaveBeenLastCalledWith({
      type: "create-audio-clip",
      clip: expect.objectContaining({
        assetId: recordingAsset.id,
        trackId: "track:audio-1",
        name: "First take",
        startFrame: 32_000,
        lengthFrames: 48_000
      })
    })

    project.projectAssets = [recordingAsset, midiAsset]
    const midiImport = useMidiImportStore()
    const prepareMidi = vi.spyOn(midiImport, "prepare").mockResolvedValue()
    const projectMidiTransfer = {
      files: [],
      types: [PROJECT_MEDIA_DRAG_TYPE],
      getData: vi.fn(() => JSON.stringify({ assetId: midiAsset.id, kind: midiAsset.kind }))
    } as unknown as DataTransfer
    await audioLane.trigger("drop", { dataTransfer: projectMidiTransfer, clientX: 0 })
    await flushPromises()
    expect(prepareMidi).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toBe(
      "MIDI assets can only be dropped on an Instrument track or blank arrangement space."
    )
    await wrapper.get(".timeline-content").trigger("drop", {
      dataTransfer: projectMidiTransfer,
      clientX: 200
    })
    await flushPromises()
    expect(prepareMidi).toHaveBeenCalledWith(
      { kind: "asset", assetId: midiAsset.id },
      { insertionTick: 3840 }
    )

    const missingAudioTransfer = {
      files: [],
      types: [PROJECT_MEDIA_DRAG_TYPE],
      getData: vi.fn(() => JSON.stringify({ assetId: "missing", kind: "audio" }))
    } as unknown as DataTransfer
    executeKeyChange.mockClear()
    await wrapper.get(".timeline-content").trigger("drop", {
      dataTransfer: missingAudioTransfer,
      clientX: 0
    })
    await flushPromises()
    expect(executeKeyChange).not.toHaveBeenCalled()

    executeKeyChange.mockResolvedValueOnce(false)
    await audioLane.trigger("drop", { dataTransfer: projectAudioTransfer, clientX: 0 })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe(
      "The audio asset could not be placed in the arrangement."
    )

    const resolveDroppedFilePaths = vi
      .spyOn(project, "resolveDroppedFilePaths")
      .mockReturnValue(["/samples/Kick.mp3"])
    vi.spyOn(project, "importAudio").mockResolvedValue([recordingAsset.id])
    const externalTransfer = {
      files: [{} as File],
      types: ["Files"],
      getData: vi.fn(() => "")
    } as unknown as DataTransfer
    await audioLane.trigger("drop", { dataTransfer: externalTransfer, clientX: 0 })
    await flushPromises()
    expect(project.importAudio).toHaveBeenCalledWith(["/samples/Kick.mp3"])
    expect(executeKeyChange).toHaveBeenLastCalledWith({
      type: "create-audio-clip",
      clip: expect.objectContaining({ assetId: recordingAsset.id, trackId: "track:audio-1" })
    })

    resolveDroppedFilePaths.mockReturnValue(["/samples/Bass.mid"])
    prepareMidi.mockClear()
    await audioLane.trigger("drop", { dataTransfer: externalTransfer, clientX: 0 })
    await flushPromises()
    expect(prepareMidi).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toBe(
      "MIDI assets can only be dropped on an Instrument track or blank arrangement space."
    )
    await wrapper.get(".timeline-content").trigger("drop", {
      dataTransfer: externalTransfer,
      clientX: 0
    })
    await flushPromises()
    expect(prepareMidi).toHaveBeenCalledWith(
      { kind: "file", path: "/samples/Bass.mid" },
      { insertionTick: 0 }
    )

    resolveDroppedFilePaths.mockReturnValue(["/samples/Kick.mp3"])
    vi.mocked(project.importAudio).mockResolvedValueOnce(["missing"])
    await audioLane.trigger("drop", { dataTransfer: externalTransfer, clientX: 0 })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe(
      "The asset was imported and retained, but no clip could be placed."
    )

    resolveDroppedFilePaths.mockReturnValue(["/samples/readme.txt"])
    await wrapper.get(".timeline-content").trigger("drop", {
      dataTransfer: externalTransfer,
      clientX: 0
    })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe(
      "This file type cannot be imported into the project."
    )

    vi.spyOn(mixer, "createAudioTrack").mockResolvedValue(false)
    const dataTransfer = {
      files: [],
      types: [PROJECT_MEDIA_DRAG_TYPE],
      getData: vi.fn(() =>
        JSON.stringify({ assetId: recordingAsset.id, kind: recordingAsset.kind })
      )
    } as unknown as DataTransfer
    await wrapper.get(".timeline-content").trigger("drop", { dataTransfer, clientX: 0 })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe(
      "The audio asset could not be placed in the arrangement."
    )
  })

  it("uses the timeline viewport as the track rail's vertical scroll source", async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const mixer = useMixerStore()
    const channels: MixerChannelState[] = [
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `audio-${index + 1}`,
        kind: "audio" as const,
        systemRole: null,
        name: `Audio ${index + 1}`,
        color: "#8C83FF",
        sortOrder: index,
        inputSource: "hardware" as const,
        inputFormat: "stereo" as const,
        gainDb: 0,
        pan: 0,
        muted: false,
        soloed: false,
        outputChannelId: "output",
        recordArmed: false,
        inputMonitoring: false,
        inputChannels: [1, 2],
        hardwareOutputChannels: []
      })),
      {
        id: "master",
        kind: "master",
        systemRole: null,
        name: "Master",
        color: "#67D9E7",
        sortOrder: 0,
        inputSource: null,
        inputFormat: null,
        gainDb: 0,
        pan: 0,
        muted: false,
        soloed: false,
        outputChannelId: null,
        recordArmed: false,
        inputMonitoring: false,
        inputChannels: [],
        hardwareOutputChannels: []
      },
      {
        id: "output",
        kind: "output",
        systemRole: null,
        name: "Output 1–2",
        color: "#73D6A2",
        sortOrder: 0,
        inputSource: null,
        inputFormat: null,
        gainDb: 0,
        pan: 0,
        muted: false,
        soloed: false,
        outputChannelId: null,
        recordArmed: false,
        inputMonitoring: false,
        inputChannels: [],
        hardwareOutputChannels: [1, 2]
      }
    ]
    mixer.graph = {
      sampleRate: 48_000,
      tracks: channels
        .filter((channel) => channel.kind === "audio" || channel.kind === "instrument")
        .map((channel) => ({
          id: `track:${channel.id}`,
          channelId: channel.id,
          sortOrder: channel.sortOrder
        })),
      channels,
      audioClips: [],
      sends: [],
      plugins: [],
      midiClips: [],
      keySignatureEvents: [{ tick: 0, fifths: 0, mode: "major" }],
      tempoMap: {
        ticksPerQuarter: 960,
        tempoEvents: [{ tick: 0, beatsPerMinute: 120 }],
        timeSignatureEvents: [{ tick: 0, numerator: 4, denominator: 4 }]
      }
    }

    const wrapper = mount(ArrangementWorkspace, {
      props: {
        recordingId: null,
        recordingStartedAt: null,
        recordingStartFrame: null,
        recordingError: ""
      },
      global: { plugins: [pinia] }
    })
    const viewport = wrapper.get<HTMLElement>('[data-testid="timeline-viewport"]')
    const rail = wrapper.get<HTMLElement>('[data-testid="timeline-rail"]')

    expect(viewport.element.contains(rail.element)).toBe(true)
    expect(rail.element.nextElementSibling).toBe(wrapper.get(".timeline-content").element)

    await rail.trigger("wheel", { shiftKey: true, deltaY: 80 })
    expect(viewport.element.scrollLeft).toBe(80)
  })
})

describe("ArrangementWorkspace recording", () => {
  it("shows a growing capture clip while recording", () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const project = useProjectStore()
    project.applyLifecycleState({
      status: "open",
      session: {
        id: "project",
        path: "project.heron",
        configuration: {
          name: "Session",
          sampleRate: 48_000,
          timeSignatureNumerator: 4,
          timeSignatureDenominator: 4,
          waveformDisplayMode: "separate"
        },
        dirty: false,
        recoveredWorkingCopy: false
      },
      error: null
    })
    const mixer = useMixerStore()
    mixer.graph = {
      sampleRate: 48_000,
      tracks: [{ id: "track:audio-1", channelId: "audio-1", sortOrder: 0 }],
      channels: [
        {
          id: "audio-1",
          kind: "audio",
          systemRole: null,
          name: "Audio 1",
          color: "#8C83FF",
          sortOrder: 0,
          inputSource: "hardware",
          inputFormat: "stereo",
          gainDb: 0,
          pan: 0,
          muted: false,
          soloed: false,
          outputChannelId: "output",
          recordArmed: true,
          inputMonitoring: false,
          inputChannels: [1, 2],
          hardwareOutputChannels: []
        },
        {
          id: "master",
          kind: "master",
          systemRole: null,
          name: "Master",
          color: "#67D9E7",
          sortOrder: 0,
          inputSource: null,
          inputFormat: null,
          gainDb: 0,
          pan: 0,
          muted: false,
          soloed: false,
          outputChannelId: null,
          recordArmed: false,
          inputMonitoring: false,
          inputChannels: [],
          hardwareOutputChannels: []
        },
        {
          id: "output",
          kind: "output",
          systemRole: null,
          name: "Output 1–2",
          color: "#73D6A2",
          sortOrder: 0,
          inputSource: null,
          inputFormat: null,
          gainDb: 0,
          pan: 0,
          muted: false,
          soloed: false,
          outputChannelId: null,
          recordArmed: false,
          inputMonitoring: false,
          inputChannels: [],
          hardwareOutputChannels: [1, 2]
        }
      ],
      audioClips: [],
      sends: [],
      plugins: [],
      midiClips: [],
      keySignatureEvents: [{ tick: 0, fifths: 0, mode: "major" }],
      tempoMap: {
        ticksPerQuarter: 960,
        tempoEvents: [{ tick: 0, beatsPerMinute: 120 }],
        timeSignatureEvents: [{ tick: 0, numerator: 4, denominator: 4 }]
      }
    }

    const transport = useTransportStore()
    transport.snapshot = {
      state: "recording",
      positionFrames: 48_000,
      positionTicks: 1_920,
      sampleRate: 48_000,
      loopEnabled: false,
      loopRange: null
    }

    const wrapper = mount(ArrangementWorkspace, {
      props: {
        recordingId: "recording-live",
        recordingStartedAt: Date.now() - 1_000,
        recordingStartFrame: 0,
        recordingAudioTrackIds: ["audio-1"],
        recordingError: ""
      },
      global: { plugins: [pinia] }
    })

    expect(
      wrapper.get('[role="button"][aria-label="Recording New recording"]').attributes("aria-label")
    ).toBe("Recording New recording")
    expect(
      wrapper.get<HTMLElement>('[role="button"][aria-label="Recording New recording"]').element
        .style.width
    ).toBe("100px")
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })
})

const channel: MixerChannelState = {
  id: "audio-1",
  kind: "audio",
  systemRole: null,
  name: "Audio 1",
  color: "#8c83ff",
  sortOrder: 0,
  inputSource: "hardware",
  inputFormat: "stereo",
  gainDb: 0,
  pan: 0,
  muted: false,
  soloed: false,
  outputChannelId: null,
  recordArmed: false,
  inputMonitoring: false,
  inputChannels: [1, 2],
  hardwareOutputChannels: []
}

function row(kind: "audio" | "instrument" = "audio"): ArrangementTrackRow {
  return {
    track: {
      ...channel,
      id: kind === "audio" ? channel.id : "instrument-1",
      kind,
      inputSource: kind === "audio" ? "hardware" : null,
      inputFormat: kind === "audio" ? "stereo" : null,
      inputChannels: kind === "audio" ? [1, 2] : [],
      trackId: `track:${kind}`,
      sortOrder: 0
    },
    audioClips: [],
    midiClips: [],
    scale: 1,
    height: 88
  }
}

const tempoMap: TempoMapSnapshot = {
  ticksPerQuarter: 960,
  tempoEvents: [{ tick: 0, beatsPerMinute: 120 }],
  timeSignatureEvents: [{ tick: 0, numerator: 4, denominator: 4 }]
}

function timelineProps(trackRow = row()) {
  return {
    row: trackRow,
    tempoMap,
    contentWidth: 1_200,
    pixelsPerQuarter: 120,
    amplitudeScale: 1,
    displayMode: "separate" as const,
    viewportStartSeconds: 0,
    viewportEndSeconds: 8,
    selectedAudioClipId: null,
    selectedMidiClipIds: [],
    keyboardInsertionTick: 960,
    playheadTick: 960,
    playheadFrame: 24_000,
    snap: "1/16" as const,
    audioDragPreview: null,
    draggingAudioClipId: null,
    midiDragPreview: null,
    draggingMidiClipId: null,
    liveAudioClip: null,
    recordingMidi: false,
    recordingStartTick: 0,
    recordingPositionTick: 960,
    liveMidiTake: null
  }
}

describe("ArrangementWorkspace presentational children", () => {
  it("keeps the track rail props-down/events-up", async () => {
    const wrapper = mount(ArrangementTrackRail, {
      props: {
        rows: [row()],
        selectedChannelId: channel.id,
        trackHeight: 88
      },
      global: { plugins: [createPinia()] }
    })

    await wrapper
      .get(".track-header")
      .trigger("pointerdown", { pointerId: 1, clientX: 10, clientY: 10 })
    await wrapper.get(".track-header").trigger("keydown", { altKey: true, key: "ArrowDown" })
    wrapper.getComponent(InlineTrackNameEditor).vm.$emit("rename", "Lead")
    wrapper.getComponent(TrackQuickControls).vm.$emit("updateChannel", channel.id, { muted: true })

    expect(wrapper.emitted("select")).toEqual([[channel.id]])
    expect(wrapper.emitted("reorder")).toEqual([[0, 1]])
    expect(wrapper.emitted("rename")).toEqual([[channel.id, "Lead"]])
    expect(wrapper.emitted("updateChannel")).toEqual([[channel.id, { muted: true }]])
  })

  it("relays typed audio and MIDI lane contracts", () => {
    const audio = shallowMount(ArrangementTimelineTrack, { props: timelineProps() })
    audio.getComponent(ArrangementTrack).vm.$emit("trim", "clip-1", "start", 120)
    audio.getComponent(ArrangementTrack).vm.$emit("clipDragStart", "clip-1", 24)
    expect(audio.emitted("trimAudioClip")).toEqual([["clip-1", "start", 120]])
    expect(audio.emitted("audioClipDragStart")).toEqual([["clip-1", 24]])

    const instrument = shallowMount(ArrangementTimelineTrack, {
      props: {
        ...timelineProps(row("instrument")),
        recordingMidi: true,
        liveMidiTake: { clipId: "take-1", trackId: "track:instrument", notes: [] }
      }
    })
    const midiLane = instrument.getComponent(MidiArrangementTrack)
    expect(midiLane.props("recording")).toBe(true)
    expect(midiLane.props("liveTake")).toEqual({
      clipId: "take-1",
      trackId: "track:instrument",
      notes: []
    })
    midiLane.vm.$emit("select", "midi-1", true)
    midiLane.vm.$emit("create", "track:instrument", 1_920)
    expect(instrument.emitted("selectMidiClip")).toEqual([["midi-1", true]])
    expect(instrument.emitted("createMidiClip")).toEqual([["track:instrument", 1_920]])
  })

  it("does not hide preload or store access inside presentational children", () => {
    for (const source of [ArrangementTrackRailSource, ArrangementTimelineTrackSource]) {
      expect(source).not.toContain("window.heron")
      expect(source).not.toContain("useMixerStore")
      expect(source).not.toContain("useArrangementViewStore")
    }
  })
})
