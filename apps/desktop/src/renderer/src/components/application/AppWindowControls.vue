<script setup lang="ts">
import { Minus, Square, X } from "@lucide/vue"
import type { ApplicationWindowCommandId } from "@heron/contracts"
import { UiWindowControls } from "@heron/ui"
import { useI18n } from "vue-i18n"

const emit = defineEmits<{ command: [command: ApplicationWindowCommandId] }>()
const { t } = useI18n()
</script>

<template>
  <UiWindowControls
    :label="t('chrome.windowControls')"
    :minimize-label="t('chrome.minimize')"
    :maximize-label="t('chrome.maximizeOrRestore')"
    :close-label="t('chrome.close')"
    minimize-command="window.minimize"
    maximize-command="window.toggle-maximize"
    close-command="window.close"
    @command="emit('command', $event)"
  >
    <template #minimize><Minus :size="13" :stroke-width="1.6" /></template>
    <template #maximize><Square :size="10" :stroke-width="1.6" /></template>
    <template #close><X :size="13" :stroke-width="1.6" /></template>
  </UiWindowControls>
</template>
