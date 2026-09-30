<script setup lang="ts">
import { useI18n } from "vue-i18n"
import { FileAudio, Settings2 } from "@lucide/vue"
import { UiButton } from "@heron/ui"

defineProps<{ name: string; pending: boolean }>()
defineEmits<{ configure: [] }>()
const { t } = useI18n()
</script>

<template>
  <aside
    class="live-project-panel flex min-h-0 min-w-0 flex-col border-r border-r-solid border-ui-border bg-[var(--ui-color-surface-sunken)]"
    :aria-label="t('live.document')"
  >
    <header
      class="flex h-[43px] flex-none items-center border-b border-b-solid border-ui-border px-ui-4 text-ui-xs text-ui-text-muted"
    >
      {{ t("live.document") }}
    </header>
    <div
      class="flex min-w-0 items-center gap-ui-3 border-b border-b-solid border-ui-border bg-[var(--ui-color-surface-active)] px-ui-4 py-ui-3"
      aria-current="page"
    >
      <FileAudio :size="14" class="flex-none text-ui-text-muted" />
      <span class="truncate text-ui-sm" :title="name">{{ name }}</span>
    </div>
    <div class="mt-auto border-t border-t-solid border-ui-border p-ui-3">
      <UiButton
        variant="ghost"
        size="sm"
        class="w-full justify-start"
        :disabled="pending"
        @click="$emit('configure')"
      >
        <Settings2 :size="14" />{{ t("live.devices") }}
      </UiButton>
    </div>
  </aside>
</template>
