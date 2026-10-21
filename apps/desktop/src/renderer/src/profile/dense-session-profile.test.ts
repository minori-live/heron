import { performance } from "node:perf_hooks"
import { mount } from "@vue/test-utils"
import { computed, defineComponent, h, nextTick, provide, shallowRef } from "vue"
import type { ComponentPublicInstance } from "vue"
import { createPinia } from "pinia"
import { describe, expect, it } from "vitest"
import type { MixerChannelMeter } from "@heron/contracts"
import AudioClipCard from "../components/studio/AudioClipCard.vue"
import MixerChannelMeterDisplay from "../components/mixer/MixerChannelMeterDisplay.vue"
import { mixerMeterSourceKey } from "../components/mixer/mixer-surface-context"
import { arrangementPlayheadKey } from "../components/studio/arrangement-playhead"
import { ipcTraffic, mixerSnapshotBytes, resetIpcTraffic, recordIpcTraffic } from "../ipc-traffic"
import type { TimelineClip } from "../stores/transport"

const TRACKS = 128
const FRAMES = 30

const tempoMap = {
  ticksPerQuarter: 960 as const,
  tempoEvents: [{ tick: 0, beatsPerMinute: 120 }],
  timeSignatureEvents: [{ tick: 0, numerator: 4, denominator: 4 }]
}

function clip(index: number): TimelineClip {
  const startFrame = index * 48_000
  return {
    id: `clip-${index}`,
    assetId: `asset-${index}`,
    trackId: `track-${index}`,
    name: `Take ${index}`,
    startSeconds: index,
    durationSeconds: 1,
    endSeconds: index + 1,
    channels: 2,
    sampleRate: 48_000,
    projectSampleRate: 48_000,
    startFrame,
    sourceOffsetFrames: 0,
    lengthFrames: 48_000,
    sourceLengthFrames: 96_000,
    fadeInFrames: 0,
    fadeOutFrames: 0
  }
}

function meter(index: number, peak: number): MixerChannelMeter {
  return {
    channelId: `track-${index}`,
    preFaderPeak: [peak, peak * 0.5],
    postFaderPeak: [peak, peak * 0.5],
    heldPeak: [peak, peak * 0.5],
    clipped: false
  }
}

function componentName(instance: ComponentPublicInstance): string {
  const type = instance.$?.type as { name?: string; __name?: string }
  return type.name ?? type.__name ?? ""
}

function updateCounter(names: readonly string[]) {
  const counts = new Map<string, number>()
  return {
    mixin: {
      updated() {
        const name = componentName(this as unknown as ComponentPublicInstance)
        if (!names.includes(name)) return
        counts.set(name, (counts.get(name) ?? 0) + 1)
      }
    },
    count(name: string) {
      return counts.get(name) ?? 0
    },
    reset() {
      counts.clear()
    }
  }
}

const clips = Array.from({ length: TRACKS }, (_, index) => clip(index))
const steadyMeters = Array.from({ length: TRACKS }, (_, index) => meter(index, 0.5))
const meterDisplayOptions = {
  meterPeakHold: "800ms" as const,
  meterReturnRate: "iec-type-i" as const,
  softwareMonitoringEnabled: false
}

describe("dense session render cost", () => {
  it("re-renders clip cards when the playhead is passed as a prop", async () => {
    const playheadFrame = shallowRef(0)
    const counter = updateCounter(["AudioClipCard"])
    const Host = defineComponent({
      name: "PlayheadPropHost",
      setup() {
        return () =>
          h(
            "div",
            clips.map((entry) =>
              h(AudioClipCard, {
                key: entry.id,
                clip: entry,
                tempoMap,
                pixelsPerQuarter: 80,
                viewportStartSeconds: 0,
                viewportEndSeconds: 160,
                amplitudeScale: 1,
                displayMode: "separate" as const,
                selected: false,
                trackColor: "#73d6a2",
                playheadFrame: playheadFrame.value
              })
            )
          )
      }
    })
    const wrapper = mount(Host, {
      global: { plugins: [createPinia()], mixins: [counter.mixin] }
    })
    await nextTick()
    counter.reset()
    const started = performance.now()
    for (let frame = 0; frame < FRAMES; frame += 1) {
      playheadFrame.value = 24_000 + frame * 64
      await nextTick()
    }
    const elapsed = performance.now() - started
    const cardUpdates = counter.count("AudioClipCard")
    console.log(
      JSON.stringify({
        case: "playhead-prop",
        tracks: TRACKS,
        frames: FRAMES,
        cardUpdates,
        elapsedMs: Number(elapsed.toFixed(2)),
        frameMs: Number((elapsed / FRAMES).toFixed(2))
      })
    )
    expect(cardUpdates).toBe(TRACKS * FRAMES)
    wrapper.unmount()
  })

  it("does not re-render clip cards when the playhead stays inside the same clips", async () => {
    const playheadFrame = shallowRef(24_000)
    const membership = computed(() => (playheadFrame.value < 48_000 ? "clip-0" : ""))
    const counter = updateCounter(["AudioClipCard"])
    const Host = defineComponent({
      name: "PlayheadInjectHost",
      setup() {
        provide(arrangementPlayheadKey, {
          frame: () => playheadFrame.value,
          tick: () => 0,
          audioMembership: membership,
          midiMembership: computed(() => "")
        })
        return () =>
          h("div", [
            h("i", { class: "playhead", style: { left: `${playheadFrame.value}px` } }),
            ...clips.map((entry) =>
              h(AudioClipCard, {
                key: entry.id,
                clip: entry,
                tempoMap,
                pixelsPerQuarter: 80,
                viewportStartSeconds: 0,
                viewportEndSeconds: 160,
                amplitudeScale: 1,
                displayMode: "separate" as const,
                selected: false,
                trackColor: "#73d6a2",
                playheadFrame: 0
              })
            )
          ])
      }
    })
    const wrapper = mount(Host, {
      global: { plugins: [createPinia()], mixins: [counter.mixin] }
    })
    await nextTick()
    counter.reset()
    const started = performance.now()
    for (let frame = 0; frame < FRAMES; frame += 1) {
      playheadFrame.value = 24_000 + frame * 64
      await nextTick()
    }
    const elapsed = performance.now() - started
    const cardUpdates = counter.count("AudioClipCard")
    console.log(
      JSON.stringify({
        case: "playhead-membership",
        tracks: TRACKS,
        frames: FRAMES,
        cardUpdates,
        elapsedMs: Number(elapsed.toFixed(2)),
        frameMs: Number((elapsed / FRAMES).toFixed(2))
      })
    )
    expect(cardUpdates).toBe(0)
    expect(wrapper.get(".playhead").attributes("style")).toContain("left:")
    wrapper.unmount()
  })

  it("skips meter display updates while the painted percent stays put", async () => {
    const meters = shallowRef(Array.from({ length: TRACKS }, (_, index) => meter(index, 0.5)))
    const counter = updateCounter(["MixerChannelMeterDisplay"])
    const Host = defineComponent({
      name: "MeterHost",
      setup() {
        provide(mixerMeterSourceKey, (channelId) =>
          meters.value.find((entry) => entry.channelId === channelId)
        )
        return () =>
          h(
            "div",
            steadyMeters.map((entry) =>
              h(MixerChannelMeterDisplay, {
                key: entry.channelId,
                channelId: entry.channelId,
                channelName: entry.channelId,
                displayOptions: meterDisplayOptions
              })
            )
          )
      }
    })
    const wrapper = mount(Host, {
      global: { plugins: [createPinia()], mixins: [counter.mixin] }
    })
    await nextTick()
    counter.reset()
    const started = performance.now()
    for (let frame = 0; frame < FRAMES; frame += 1) {
      meters.value = Array.from({ length: TRACKS }, (_, index) => meter(index, 0.5))
      await nextTick()
    }
    const elapsed = performance.now() - started
    const displayUpdates = counter.count("MixerChannelMeterDisplay")
    console.log(
      JSON.stringify({
        case: "meter-steady",
        tracks: TRACKS,
        frames: FRAMES,
        displayUpdates,
        elapsedMs: Number(elapsed.toFixed(2)),
        frameMs: Number((elapsed / FRAMES).toFixed(2))
      })
    )
    expect(displayUpdates).toBe(0)
    wrapper.unmount()
  })

  it("counts steady 128-track meter and transport polls", () => {
    resetIpcTraffic()
    const meters = Array.from({ length: TRACKS }, (_, index) => meter(index, 0.5))
    const bytes = mixerSnapshotBytes(meters)
    for (let frame = 0; frame < FRAMES; frame += 1) {
      recordIpcTraffic("mixer-snapshot", bytes)
      recordIpcTraffic("transport-snapshot", 96)
    }
    const traffic = ipcTraffic()
    const mixer = traffic.find((entry) => entry.channel === "mixer-snapshot")
    const transport = traffic.find((entry) => entry.channel === "transport-snapshot")
    console.log(
      JSON.stringify({
        case: "ipc-30hz",
        mixerBytes: bytes,
        mixerMessages: mixer?.messages,
        mixerBytesPerSecond: (bytes * 30).toFixed(0),
        transportMessages: transport?.messages,
        combinedMessagesPerSecond: 60,
        combinedBytesPerSecond: bytes * 30 + 96 * 30
      })
    )
    expect(mixer?.messages).toBe(FRAMES)
    expect(transport?.messages).toBe(FRAMES)
    expect(bytes).toBeGreaterThan(TRACKS * 40)
    resetIpcTraffic()
  })
})
