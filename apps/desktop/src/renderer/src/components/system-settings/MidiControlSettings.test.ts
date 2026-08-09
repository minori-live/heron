import { createTestingPinia } from "@pinia/testing"
import { flushPromises, mount } from "@vue/test-utils"
import { setActivePinia } from "pinia"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { MidiControlEvent } from "@heron/contracts"
import { BUILTIN_MIDI_TRANSFORM_PROFILE_IDS } from "@heron/contracts"
import { useApplicationSettingsStore } from "../../stores/applicationSettings"
import { useMidiInputStore } from "../../stores/midiInput"
import { useMixerStore } from "../../stores/mixer"
import { usePluginStore } from "../../stores/plugins"
import { EMPTY_PROJECT_GRAPH, useProjectGraphStore } from "../../stores/projectGraph"
import MidiControlSettings from "./MidiControlSettings.vue"

const MappingListStub = {
  props: ["groups", "ports"],
  emits: ["add", "remove"],
  template: `
    <div data-test="mapping-list" :data-groups="groups.length" :data-ports="ports.length">
      <button data-test="add" @click="$emit('add')">Add</button>
      <button data-test="remove" @click="$emit('remove', 'remove-me')">Remove</button>
    </div>
  `
}

const MappingEditorStub = {
  props: ["address", "inputMode", "targetType", "mixerParameter", "error", "monitor"],
  emits: [
    "learn",
    "cancel",
    "save",
    "update:address",
    "update:inputMode",
    "update:relativeEncoding",
    "update:targetType",
    "update:mixerIndex",
    "update:mixerParameter",
    "update:booleanBehavior",
    "update:profileId",
    "update:pluginAlias",
    "update:parameterKey"
  ],
  template: `
    <div data-test="mapping-editor" :data-error="error" :data-raw="monitor.raw">
      <button data-test="learn" @click="$emit('learn')">Learn</button>
      <button data-test="cancel" @click="$emit('cancel')">Cancel</button>
      <button data-test="save" @click="$emit('save')">Save</button>
      <button data-test="valid-address" @click="$emit('update:address', { portId: 'port-1', portName: 'Controller', channel: 0, type: 'control-change', number: 7 })">Valid address</button>
      <button data-test="bad-channel" @click="$emit('update:address', { ...address, portId: 'port-1', portName: 'Controller', channel: 16 })">Bad channel</button>
      <button data-test="bad-number" @click="$emit('update:address', { ...address, portId: 'port-1', portName: 'Controller', channel: 0, number: 128 })">Bad number</button>
      <button data-test="note" @click="$emit('update:address', { ...address, portId: 'port-1', portName: 'Controller', channel: 0, type: 'note', number: 60 })">Note</button>
      <button data-test="cc" @click="$emit('update:address', { ...address, portId: 'port-1', portName: 'Controller', channel: 0, type: 'control-change', number: 7 })">CC</button>
      <button data-test="relative" @click="$emit('update:inputMode', 'relative')">Relative</button>
      <button data-test="mixer-gain" @click="$emit('update:targetType', 'mixer'); $emit('update:mixerParameter', 'gain'); $emit('update:mixerIndex', 2)">Mixer gain</button>
      <button data-test="mixer-mute" @click="$emit('update:targetType', 'mixer'); $emit('update:mixerParameter', 'mute')">Mixer mute</button>
      <button data-test="absolute-behavior" @click="$emit('update:booleanBehavior', 'absolute')">Absolute behavior</button>
      <button data-test="plugin" @click="$emit('update:targetType', 'plugin-parameter'); $emit('update:pluginAlias', 'lead'); $emit('update:parameterKey', 'cutoff')">Plugin</button>
      <button data-test="bad-plugin" @click="$emit('update:targetType', 'plugin-parameter'); $emit('update:pluginAlias', 'Bad Alias'); $emit('update:parameterKey', '')">Bad plugin</button>
    </div>
  `
}

const ProfileSettingsStub = {
  props: ["profiles", "draft"],
  emits: ["edit", "save", "cancel", "update:draft"],
  template: `
    <div data-test="profiles" :data-count="profiles.length" :data-draft="draft?.name ?? ''">
      <button data-test="edit-builtin" @click="$emit('edit', profiles[0])">Edit built-in</button>
      <button data-test="edit-custom" @click="$emit('edit', { id: 'custom', name: 'Custom', type: 'relative', baseStep: 0.01, acceleration: [], builtin: false })">Edit custom</button>
      <button data-test="save-profile" @click="$emit('save')">Save profile</button>
      <button data-test="cancel-profile" @click="$emit('cancel')">Cancel profile</button>
    </div>
  `
}

const AliasSettingsStub = {
  props: ["plugins", "parameters", "aliasDrafts"],
  emits: ["updateAlias", "saveAlias", "chooseParameter"],
  template: `
    <div data-test="aliases" :data-count="plugins.length" :data-draft="aliasDrafts['plugin-1'] ?? ''">
      <button data-test="update-alias" @click="$emit('updateAlias', 'plugin-1', ' lead ')">Update alias</button>
      <button data-test="clear-alias" @click="$emit('updateAlias', 'plugin-1', '   '); $emit('saveAlias', 'plugin-1')">Clear alias</button>
      <button data-test="save-alias" @click="$emit('saveAlias', 'plugin-1')">Save alias</button>
      <button data-test="choose-parameter" @click="$emit('chooseParameter', 'lead', 'cutoff')">Choose parameter</button>
    </div>
  `
}

function controlEvent(overrides: Partial<MidiControlEvent> = {}): MidiControlEvent {
  return {
    generation: 1,
    portId: "port-1",
    portName: "Controller",
    channel: 1,
    type: "control-change",
    number: 74,
    value: 127,
    timestampMicroseconds: 1_000,
    ...overrides
  }
}

function mountSettings() {
  const pinia = createTestingPinia({ createSpy: vi.fn })
  setActivePinia(pinia)
  const settings = useApplicationSettingsStore()
  const midi = useMidiInputStore()
  const mixer = useMixerStore()
  const plugins = usePluginStore()
  const graph = useProjectGraphStore()
  settings.settings = {
    midiControl: {
      bindings: [
        {
          id: "remove-me",
          address: {
            portId: "port-1",
            portName: "Controller",
            channel: 0,
            type: "control-change",
            number: 7
          },
          input: { type: "absolute" },
          target: { type: "application-command", command: "project.save" }
        }
      ],
      transformProfiles: [
        {
          id: "custom",
          name: "Custom",
          type: "relative",
          baseStep: 0.01,
          acceleration: [],
          builtin: false
        }
      ]
    }
  } as never
  midi.snapshot = {
    ports: [{ id: "port-1", name: "Controller", connected: true }],
    sync: {
      state: "internal",
      sourcePortId: null,
      sourcePortName: null,
      effectiveBpm: null,
      jitterMicroseconds: null,
      lastClockAgeMs: null,
      droppedEvents: 0,
      ignoredSystemMessages: 0,
      error: null
    },
    activeNotes: [],
    controlEvents: [],
    capturedAt: 0
  }
  graph.graph = {
    ...structuredClone(EMPTY_PROJECT_GRAPH),
    plugins: [
      {
        id: "plugin-1",
        descriptor: { name: "Synth", vendor: "Heron" },
        locator: { format: "vst3" },
        controlAlias: "lead"
      } as never
    ]
  }
  plugins.parameters = {
    "plugin-1": [
      {
        parameterKey: "cutoff",
        title: "Cutoff",
        hidden: false,
        readOnly: false,
        automatable: true
      } as never
    ]
  }
  let listener: ((event: MidiControlEvent) => void) | undefined
  const unsubscribe = vi.fn()
  vi.mocked(midi.subscribeControls).mockImplementation((next) => {
    listener = next
    return unsubscribe
  })

  const wrapper = mount(MidiControlSettings, {
    global: {
      plugins: [pinia],
      stubs: {
        MidiControlMappingList: MappingListStub,
        MidiControlMappingEditor: MappingEditorStub,
        MidiControlProfileSettings: ProfileSettingsStub,
        MidiPluginAliasSettings: AliasSettingsStub
      }
    }
  })
  return { wrapper, settings, midi, mixer, listener: () => listener, unsubscribe }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("MidiControlSettings", () => {
  it("groups bindings, removes one, and cleans up its MIDI subscription", async () => {
    const { wrapper, settings, midi, unsubscribe } = mountSettings()

    expect(wrapper.get('[data-test="mapping-list"]').attributes("data-groups")).toBe("1")
    expect(midi.load).toHaveBeenCalledOnce()
    await wrapper.get('[data-test="remove"]').trigger("click")

    expect(settings.configureMidiControl).toHaveBeenCalledWith(
      expect.objectContaining({ bindings: [] })
    )
    wrapper.unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it("learns an address, updates the monitor, and saves command and continuous mappings", async () => {
    const { wrapper, settings, midi, listener } = mountSettings()
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001")

    await wrapper.get('[data-test="add"]').trigger("click")
    expect(midi.beginLearning).toHaveBeenCalledOnce()
    midi.learning = true
    expect(listener()).toBeTypeOf("function")
    listener()?.(controlEvent())
    await flushPromises()

    expect(wrapper.get('[data-test="mapping-editor"]').attributes("data-raw")).toBe("127")
    expect(midi.endLearning).toHaveBeenCalledOnce()
    await wrapper.get('[data-test="save"]').trigger("click")
    expect(settings.configureMidiControl).toHaveBeenLastCalledWith(
      expect.objectContaining({
        bindings: expect.arrayContaining([
          expect.objectContaining({
            id: "00000000-0000-4000-8000-000000000001",
            input: { type: "absolute" }
          })
        ])
      })
    )

    await wrapper.get('[data-test="add"]').trigger("click")
    await wrapper.get('[data-test="valid-address"]').trigger("click")
    await wrapper.get('[data-test="mixer-gain"]').trigger("click")
    await wrapper.get('[data-test="relative"]').trigger("click")
    await wrapper.get('[data-test="save"]').trigger("click")
    expect(settings.configureMidiControl).toHaveBeenLastCalledWith(
      expect.objectContaining({
        bindings: expect.arrayContaining([
          expect.objectContaining({
            input: { type: "relative", encoding: "one-127" },
            target: { type: "mixer", channelIndex: 2, parameter: "gain" },
            transformProfileId: BUILTIN_MIDI_TRANSFORM_PROFILE_IDS.relativeNormal
          })
        ])
      })
    )
  })

  it("reports incompatible drafts and saves plugin and boolean targets", async () => {
    const { wrapper, settings } = mountSettings()

    await wrapper.get('[data-test="add"]').trigger("click")
    expect(wrapper.get('[data-test="mapping-editor"]').attributes("data-error")).toContain(
      "Device ID"
    )
    await wrapper.get('[data-test="bad-channel"]').trigger("click")
    expect(wrapper.get('[data-test="mapping-editor"]').attributes("data-error")).toContain(
      "Channel"
    )
    await wrapper.get('[data-test="bad-number"]').trigger("click")
    expect(wrapper.get('[data-test="mapping-editor"]').attributes("data-error")).toContain(
      "Message number"
    )
    await wrapper.get('[data-test="note"]').trigger("click")
    await wrapper.get('[data-test="plugin"]').trigger("click")
    expect(wrapper.get('[data-test="mapping-editor"]').attributes("data-error")).toContain(
      "Note On supports"
    )
    await wrapper.get('[data-test="mixer-mute"]').trigger("click")
    await wrapper.get('[data-test="absolute-behavior"]').trigger("click")
    expect(wrapper.get('[data-test="mapping-editor"]').attributes("data-error")).toContain(
      "cannot set"
    )
    await wrapper.get('[data-test="cc"]').trigger("click")
    await wrapper.get('[data-test="relative"]').trigger("click")
    expect(wrapper.get('[data-test="mapping-editor"]').attributes("data-error")).toContain(
      "continuous targets"
    )
    await wrapper.get('[data-test="plugin"]').trigger("click")
    expect(wrapper.get('[data-test="mapping-editor"]').attributes("data-error")).toBe("")
    await wrapper.get('[data-test="save"]').trigger("click")
    expect(settings.configureMidiControl).toHaveBeenLastCalledWith(
      expect.objectContaining({
        bindings: expect.arrayContaining([
          expect.objectContaining({
            target: { type: "plugin-parameter", controlAlias: "lead", parameterKey: "cutoff" }
          })
        ])
      })
    )

    await wrapper.get('[data-test="add"]').trigger("click")
    await wrapper.get('[data-test="valid-address"]').trigger("click")
    await wrapper.get('[data-test="bad-plugin"]').trigger("click")
    expect(wrapper.get('[data-test="mapping-editor"]').attributes("data-error")).toContain(
      "lowercase control alias"
    )
  })

  it("duplicates and saves profiles, updates aliases, and selects a plug-in parameter", async () => {
    const { wrapper, settings, mixer } = mountSettings()
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000002")

    await wrapper.get('[data-test="edit-builtin"]').trigger("click")
    expect(wrapper.get('[data-test="profiles"]').attributes("data-draft")).toContain("copy")
    await wrapper.get('[data-test="save-profile"]').trigger("click")
    expect(settings.configureMidiControl).toHaveBeenLastCalledWith(
      expect.objectContaining({
        transformProfiles: expect.arrayContaining([
          expect.objectContaining({
            id: "00000000-0000-4000-8000-000000000002",
            builtin: false
          })
        ])
      })
    )

    await wrapper.get('[data-test="edit-custom"]').trigger("click")
    await wrapper.get('[data-test="cancel-profile"]').trigger("click")
    expect(wrapper.get('[data-test="profiles"]').attributes("data-draft")).toBe("")

    await wrapper.get('[data-test="update-alias"]').trigger("click")
    expect(wrapper.get('[data-test="aliases"]').attributes("data-draft")).toBe(" lead ")
    await wrapper.get('[data-test="save-alias"]').trigger("click")
    expect(mixer.execute).toHaveBeenLastCalledWith({
      type: "update-plugin",
      pluginId: "plugin-1",
      patch: { controlAlias: "lead" }
    })
    await wrapper.get('[data-test="clear-alias"]').trigger("click")
    expect(mixer.execute).toHaveBeenLastCalledWith({
      type: "update-plugin",
      pluginId: "plugin-1",
      patch: { controlAlias: null }
    })
    await wrapper.get('[data-test="choose-parameter"]').trigger("click")
    await wrapper.get('[data-test="add"]').trigger("click")
    expect(wrapper.get('[data-test="mapping-editor"]').attributes("data-error")).toContain(
      "Device ID"
    )
  })

  it("cancels learning and ends an active learning session when unmounted", async () => {
    const { wrapper, midi } = mountSettings()

    await wrapper.get('[data-test="add"]').trigger("click")
    await wrapper.get('[data-test="cancel"]').trigger("click")
    expect(midi.endLearning).toHaveBeenCalledOnce()

    await wrapper.get('[data-test="add"]').trigger("click")
    midi.learning = true
    wrapper.unmount()
    expect(midi.endLearning).toHaveBeenCalledTimes(2)
  })
})
