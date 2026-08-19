<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import { UiActionRow, UiIconButton } from "@heron/ui"
import {
  pluginSupportsHostedAudioMode,
  type PluginAudioMode,
  type PluginDescriptor
} from "@heron/contracts"
import { pluginAudioModeOptions, type PluginSignalWidth } from "./plugin-audio-mode"

const props = defineProps<{
  descriptor: PluginDescriptor
  inputWidth?: PluginSignalWidth
}>()

const emit = defineEmits<{
  select: [mode: PluginAudioMode]
  cancel: []
}>()
const { t } = useI18n()
const visibleOptions = computed(() =>
  pluginAudioModeOptions(props.descriptor.kind, props.inputWidth, t)
)

function isSupported(mode: PluginAudioMode): boolean {
  return pluginSupportsHostedAudioMode(props.descriptor, mode)
}
</script>

<template>
  <section class="mode-menu" :aria-label="t('plugins.audioModeMenu.ariaLabel')">
    <header>
      <UiIconButton
        size="sm"
        density="compact"
        variant="plain"
        :label="t('plugins.audioModeMenu.back')"
        @click="emit('cancel')"
      >
        ‹
      </UiIconButton>
      <span
        ><b>{{ descriptor.name }}</b
        ><small>{{ t("plugins.audioModeMenu.chooseMode") }}</small></span
      >
    </header>
    <div class="mode-list">
      <UiActionRow
        v-for="option in visibleOptions"
        :key="option.value"
        :disabled="!isSupported(option.value)"
        :label="`${option.badge} · ${option.label}`"
        :description="option.detail"
        density="compact"
        appearance="plain"
        :title="
          isSupported(option.value)
            ? t('plugins.audioModeMenu.supported', {
                label: option.label,
                detail: option.detail
              })
            : t('plugins.audioModeMenu.notSupported', { label: option.label })
        "
        @activate="emit('select', option.value)"
      >
        <template v-if="!isSupported(option.value)" #trailing>
          <em>{{ t("plugins.audioModeMenu.unavailable") }}</em>
        </template>
      </UiActionRow>
    </div>
  </section>
</template>

<style scoped>
.mode-menu {
  display: grid;
  gap: 9px;
}
.mode-menu header {
  display: grid;
  grid-template-columns: 25px minmax(0, 1fr);
  align-items: center;
  gap: 7px;
}
.mode-menu header span,
.mode-menu header b,
.mode-menu header small {
  display: block;
  min-width: 0;
}
.mode-menu header b {
  overflow: hidden;
  font-size: var(--ui-type-size-label);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mode-menu header small {
  margin-top: 2px;
  color: var(--text-faint);
  font: var(--ui-type-size-caption) var(--ui-type-family-data);
}
.mode-list {
  display: grid;
  gap: 4px;
}
.mode-list em {
  color: var(--text-faint);
  font: var(--ui-type-size-micro) var(--ui-type-family-data);
  font-style: normal;
}
</style>
