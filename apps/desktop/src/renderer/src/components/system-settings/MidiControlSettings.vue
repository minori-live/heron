<script setup lang="ts">
import { midiTransformProfileLabel } from "../../utils/midiControlLabels"
import { useI18n } from "vue-i18n"
import { computed, onMounted, onUnmounted, ref, shallowRef } from "vue"
import {
  APPLICATION_COMMAND_IDS,
  BUILTIN_MIDI_TRANSFORM_PROFILES,
  BUILTIN_MIDI_TRANSFORM_PROFILE_IDS,
  decodeRelativeMidiValue,
  midiControlAddressKey
} from "@heron/contracts"
import type { MidiControlAddress, MidiControlEvent, MidiTransformProfile } from "@heron/contracts"
import SettingsPage from "../settings/SettingsPage.vue"
import SettingsSection from "../settings/SettingsSection.vue"
import { useApplicationSettingsStore } from "../../stores/applicationSettings"
import { useMidiInputStore } from "../../stores/midiInput"
import { useMixerStore } from "../../stores/mixer"
import { usePluginStore } from "../../stores/plugins"
import MidiControlMappingEditor from "./MidiControlMappingEditor.vue"
import MidiControlMappingList from "./MidiControlMappingList.vue"
import MidiControlProfileSettings from "./MidiControlProfileSettings.vue"
import MidiPluginAliasSettings from "./MidiPluginAliasSettings.vue"

const { t } = useI18n()

const settings = useApplicationSettingsStore()
const midi = useMidiInputStore()
const mixer = useMixerStore()
const plugins = usePluginStore()
const aliasDrafts = shallowRef<Record<string, string>>({})
const editing = shallowRef(false)
const address = ref<MidiControlAddress>({
  portId: "",
  portName: "",
  channel: 0,
  type: "control-change",
  number: 1
})
const inputMode = shallowRef<"absolute" | "relative">("absolute")
const relativeEncoding = shallowRef<"one-127" | "twos-complement" | "binary-offset">("one-127")
const targetType = shallowRef<"application-command" | "mixer" | "plugin-parameter">(
  "application-command"
)
const command = shallowRef(APPLICATION_COMMAND_IDS[0])
const mixerIndex = shallowRef(0)
const mixerParameter = shallowRef<"gain" | "pan" | "mute" | "solo">("gain")
const booleanBehavior = shallowRef<"toggle" | "absolute">("toggle")
const profileId = shallowRef("")
const pluginAlias = shallowRef("")
const parameterKey = shallowRef("")
const monitor = shallowRef({ raw: 0, delta: 0, rate: 0, normalizedDelta: 0 })
const profileDraft = ref<MidiTransformProfile | null>(null)
let unsubscribe: (() => void) | null = null
let lastTimestamp = 0

const preferences = computed(
  () => settings.settings?.midiControl ?? { bindings: [], transformProfiles: [] }
)
const profiles = computed(() => [
  ...BUILTIN_MIDI_TRANSFORM_PROFILES,
  ...preferences.value.transformProfiles
])
const compatibleProfiles = computed(() =>
  profiles.value.filter((profile) => profile.type === inputMode.value)
)
const draftError = computed(() => {
  if (!address.value.portId || !address.value.portName) {
    return t("midiSettings.controls.deviceRequired")
  }
  if (address.value.channel < 0 || address.value.channel > 15) {
    return t("midiSettings.controls.channelRange")
  }
  if (address.value.number < 0 || address.value.number > 127) {
    return t("midiSettings.controls.numberRange")
  }
  const booleanTarget =
    targetType.value === "mixer" &&
    (mixerParameter.value === "mute" || mixerParameter.value === "solo")
  if (
    address.value.type === "note" &&
    targetType.value !== "application-command" &&
    !booleanTarget
  ) {
    return t("midiSettings.controls.noteTargets")
  }
  if (address.value.type === "note" && booleanTarget && booleanBehavior.value !== "toggle") {
    return t("midiSettings.controls.noteAbsolute")
  }
  if (
    address.value.type === "control-change" &&
    inputMode.value === "relative" &&
    (targetType.value === "application-command" || booleanTarget)
  ) {
    return t("midiSettings.controls.relativeTargets")
  }
  if (
    targetType.value === "plugin-parameter" &&
    (!/^[a-z0-9][a-z0-9._-]*$/u.test(pluginAlias.value) || !parameterKey.value)
  ) {
    return t("midiSettings.controls.aliasRequired")
  }
  return ""
})
const groups = computed(() => {
  const result = new Map<string, typeof preferences.value.bindings>()
  for (const binding of preferences.value.bindings) {
    const key = midiControlAddressKey(binding.address)
    result.set(key, [...(result.get(key) ?? []), binding])
  }
  return [...result.entries()]
})

async function beginLearn(): Promise<void> {
  editing.value = true
  await midi.beginLearning()
}

async function cancelMapping(): Promise<void> {
  editing.value = false
  await midi.endLearning()
}

function receive(event: MidiControlEvent): void {
  const elapsed = lastTimestamp ? event.timestampMicroseconds - lastTimestamp : 0
  lastTimestamp = event.timestampMicroseconds
  const delta =
    event.type === "control-change"
      ? decodeRelativeMidiValue(event.value, relativeEncoding.value)
      : 0
  monitor.value = {
    raw: event.value,
    delta,
    rate: elapsed > 0 ? 1_000_000 / elapsed : 0,
    normalizedDelta: delta / 127
  }
  if (!midi.learning) return
  address.value = {
    portId: event.portId,
    portName: event.portName,
    channel: event.channel,
    type: event.type,
    number: event.number
  }
  void midi.endLearning()
}

async function saveBinding(): Promise<void> {
  const continuous =
    targetType.value === "plugin-parameter" ||
    (targetType.value === "mixer" &&
      (mixerParameter.value === "gain" || mixerParameter.value === "pan"))
  const target =
    targetType.value === "application-command"
      ? { type: "application-command" as const, command: command.value }
      : targetType.value === "plugin-parameter"
        ? {
            type: "plugin-parameter" as const,
            controlAlias: pluginAlias.value,
            parameterKey: parameterKey.value
          }
        : mixerParameter.value === "mute" || mixerParameter.value === "solo"
          ? {
              type: "mixer" as const,
              channelIndex: mixerIndex.value,
              parameter: mixerParameter.value,
              behavior: booleanBehavior.value
            }
          : {
              type: "mixer" as const,
              channelIndex: mixerIndex.value,
              parameter: mixerParameter.value
            }
  const binding = {
    id: crypto.randomUUID(),
    address: address.value,
    input:
      address.value.type === "note"
        ? { type: "note" as const }
        : inputMode.value === "relative"
          ? { type: "relative" as const, encoding: relativeEncoding.value }
          : { type: "absolute" as const },
    target,
    ...(continuous
      ? {
          transformProfileId:
            profileId.value ||
            (inputMode.value === "relative"
              ? BUILTIN_MIDI_TRANSFORM_PROFILE_IDS.relativeNormal
              : mixerParameter.value === "gain"
                ? BUILTIN_MIDI_TRANSFORM_PROFILE_IDS.dawFader
                : BUILTIN_MIDI_TRANSFORM_PROFILE_IDS.linear)
        }
      : {})
  }
  await settings.configureMidiControl({
    ...preferences.value,
    bindings: [...preferences.value.bindings, binding]
  })
  editing.value = false
}

async function removeBinding(id: string): Promise<void> {
  await settings.configureMidiControl({
    ...preferences.value,
    bindings: preferences.value.bindings.filter((binding) => binding.id !== id)
  })
}

function editProfile(profile: MidiTransformProfile): void {
  profileDraft.value = profile.builtin
    ? {
        ...structuredClone(profile),
        id: crypto.randomUUID(),
        name: t("midiSettings.controls.copyName", { name: midiTransformProfileLabel(profile, t) }),
        builtin: false
      }
    : structuredClone(profile)
}

async function saveProfile(): Promise<void> {
  if (!profileDraft.value) return
  const others = preferences.value.transformProfiles.filter(
    (profile) => profile.id !== profileDraft.value!.id
  )
  await settings.configureMidiControl({
    ...preferences.value,
    transformProfiles: [...others, profileDraft.value]
  })
  profileDraft.value = null
}

function updateAliasDraft(instanceId: string, value: string): void {
  aliasDrafts.value = { ...aliasDrafts.value, [instanceId]: value }
}

async function saveAlias(instanceId: string): Promise<void> {
  const value = (aliasDrafts.value[instanceId] ?? "").trim() || null
  await mixer.execute({
    type: "update-plugin",
    pluginId: instanceId,
    patch: { controlAlias: value }
  })
}

function choosePluginParameter(alias: string, key: string): void {
  pluginAlias.value = alias
  parameterKey.value = key
  targetType.value = "plugin-parameter"
}

onMounted(() => {
  unsubscribe = midi.subscribeControls(receive)
  void midi.load()
})

onUnmounted(() => {
  unsubscribe?.()
  if (midi.learning) void midi.endLearning()
})
</script>

<template>
  <SettingsPage
    category="MIDI"
    :page="t('midiSettings.controls.page')"
    :title="t('midiSettings.controls.title')"
    :description="t('midiSettings.controls.description')"
  >
    <SettingsSection
      :eyebrow="t('midiSettings.controls.mapping')"
      :title="t('midiSettings.controls.assignments')"
      :description="t('midiSettings.controls.assignmentsDescription')"
    >
      <MidiControlMappingEditor
        v-if="editing"
        v-model:address="address"
        v-model:input-mode="inputMode"
        v-model:relative-encoding="relativeEncoding"
        v-model:target-type="targetType"
        v-model:command="command"
        v-model:mixer-index="mixerIndex"
        v-model:mixer-parameter="mixerParameter"
        v-model:boolean-behavior="booleanBehavior"
        v-model:profile-id="profileId"
        v-model:plugin-alias="pluginAlias"
        v-model:parameter-key="parameterKey"
        :learning="midi.learning"
        :profiles="compatibleProfiles"
        :monitor="monitor"
        :error="draftError"
        :settings-error="settings.error"
        @learn="beginLearn"
        @cancel="cancelMapping"
        @save="saveBinding"
      />
      <MidiControlMappingList
        v-else
        :groups="groups"
        :ports="midi.snapshot.ports"
        @add="beginLearn"
        @remove="removeBinding"
      />
    </SettingsSection>

    <SettingsSection
      :eyebrow="t('midiSettings.controls.response')"
      :title="t('midiSettings.controls.profiles')"
      :description="t('midiSettings.controls.profilesDescription')"
    >
      <MidiControlProfileSettings
        v-model:draft="profileDraft"
        :profiles="profiles"
        @edit="editProfile"
        @save="saveProfile"
        @cancel="profileDraft = null"
      />
    </SettingsSection>

    <SettingsSection
      :eyebrow="t('midiSettings.controls.plugins')"
      :title="t('midiSettings.controls.aliases')"
      :description="t('midiSettings.controls.aliasesDescription')"
    >
      <MidiPluginAliasSettings
        :plugins="mixer.graph.plugins"
        :parameters="plugins.parameters"
        :alias-drafts="aliasDrafts"
        @update-alias="updateAliasDraft"
        @save-alias="saveAlias"
        @choose-parameter="choosePluginParameter"
      />
    </SettingsSection>

    <p v-if="settings.error && !editing" class="settings-error" role="alert">
      {{ settings.error }}
    </p>
  </SettingsPage>
</template>

<style scoped>
.settings-error {
  margin: 16px 0 0;
  padding: 11px;
  border: 1px solid color-mix(in srgb, var(--record) 38%, var(--line-soft));
  border-radius: 7px;
  color: var(--record);
  background: color-mix(in srgb, var(--record) 8%, var(--surface-1));
  font-size: var(--ui-type-size-body-compact);
}
</style>
