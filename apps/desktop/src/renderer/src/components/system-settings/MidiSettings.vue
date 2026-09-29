<script setup lang="ts">
import { computed, onMounted } from "vue"
import type { Component } from "vue"
import { storeToRefs } from "pinia"
import { useI18n } from "vue-i18n"
import { Music2, Piano } from "@lucide/vue"
import type { MidiCenterCStandard } from "@heron/contracts"
import { UiChoiceCard } from "@heron/ui"
import SettingsPage from "../settings/SettingsPage.vue"
import SettingsSection from "../settings/SettingsSection.vue"
import { useApplicationSettingsStore } from "../../stores/applicationSettings"

const { t } = useI18n()
const settingsStore = useApplicationSettingsStore()
const { settings, loading, error } = storeToRefs(settingsStore)

const centerCOptions = computed<
  ReadonlyArray<{
    value: MidiCenterCStandard
    label: string
    description: string
    icon: Component
  }>
>(() => [
  {
    value: "yamaha-c3",
    label: t("settings.midi.centerC.yamaha.label"),
    description: t("settings.midi.centerC.yamaha.description"),
    icon: Piano
  },
  {
    value: "roland-c4",
    label: t("settings.midi.centerC.roland.label"),
    description: t("settings.midi.centerC.roland.description"),
    icon: Music2
  }
])

onMounted(() => {
  if (!settings.value) void settingsStore.load()
})
</script>

<template>
  <SettingsPage
    :category="t('settings.midi.category')"
    :page="t('settings.midi.page')"
    :title="t('settings.midi.title')"
    :description="t('settings.midi.description')"
  >
    <SettingsSection
      :title="t('settings.midi.centerC.title')"
      :description="t('settings.midi.centerC.description')"
    >
      <div class="center-c-options" :aria-label="t('settings.midi.centerC.ariaLabel')">
        <UiChoiceCard
          v-for="option in centerCOptions"
          :key="option.value"
          :label="option.label"
          :description="option.description"
          :selected="(settings?.midiCenterCStandard ?? 'roland-c4') === option.value"
          :disabled="loading"
          @select="settingsStore.setMidiCenterCStandard(option.value)"
        >
          <template #icon><component :is="option.icon" :size="14" aria-hidden="true" /></template>
        </UiChoiceCard>
      </div>
    </SettingsSection>

    <p v-if="error" class="midi-error" role="alert">{{ error }}</p>
  </SettingsPage>
</template>

<style scoped>
.center-c-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
}

.midi-error {
  color: var(--record);
  font-size: var(--ui-type-size-body-compact);
}

@media (max-width: 1120px) {
  .center-c-options {
    grid-template-columns: 1fr;
  }
}
</style>
