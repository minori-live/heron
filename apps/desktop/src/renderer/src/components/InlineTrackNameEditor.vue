<script setup lang="ts">
import { useI18n } from "vue-i18n"
import { UiInlineTextEdit } from "@heron/ui"
const props = defineProps<{ name: string; label: string }>()
const emit = defineEmits<{ rename: [name: string] }>()
const { t } = useI18n()
</script>

<template>
  <UiInlineTextEdit
    :value="props.name"
    :label="props.label"
    :edit-label="t('studio.rename.renameAria', { name: props.name })"
    @commit="emit('rename', $event)"
  />
</template>
