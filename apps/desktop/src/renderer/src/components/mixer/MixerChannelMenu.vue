<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import { MoreHorizontal, Trash2 } from "@lucide/vue"
import { UiButton, UiColorInput, UiIconButton, UiPopover } from "@heron/ui"

const props = defineProps<{
  channelName: string
  color: string
  deletable: boolean
}>()

const emit = defineEmits<{
  updateColor: [color: string]
  delete: []
}>()

const { t } = useI18n()
const colorModel = computed({
  get: () => props.color,
  set: (color: string) => emit("updateColor", color.toUpperCase())
})
</script>

<template>
  <UiPopover side="top" align="end" :side-offset="6">
    <template #trigger>
      <UiIconButton
        class="menu-trigger"
        size="sm"
        :label="t('mixer.channelMenu.ariaLabel', { name: channelName })"
      >
        <MoreHorizontal :size="13" />
      </UiIconButton>
    </template>
    <div class="channel-menu">
      <label>
        <span>{{ t("mixer.channelMenu.channelColor") }}</span>
        <UiColorInput
          v-model="colorModel"
          :label="t('mixer.channelMenu.colorAria', { name: channelName })"
        />
      </label>
      <UiButton
        v-if="deletable"
        class="delete-action"
        size="sm"
        variant="danger"
        :aria-label="t('mixer.channelMenu.deleteAria', { name: channelName })"
        @click="emit('delete')"
      >
        <Trash2 :size="12" />{{ t("mixer.channelMenu.delete") }}
      </UiButton>
    </div>
  </UiPopover>
</template>

<style scoped>
.menu-trigger {
  display: grid;
  flex: none;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--ui-domain-menu-trigger-border);
  border-radius: 3px;
  color: var(--ui-domain-signal-ink);
  background: var(--ui-domain-menu-trigger-fill);
}
.channel-menu {
  display: grid;
  width: 168px;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--ui-color-border-strong);
  border-radius: 6px;
  color: var(--ui-color-text);
  background: var(--ui-color-surface);
  box-shadow: 0 14px 36px var(--ui-domain-popover-shadow);
}
.channel-menu label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--ui-color-text-subtle);
  font-size: var(--ui-type-size-control);
}
.delete-action {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 27px;
  padding: 0 8px;
  border: 1px solid color-mix(in srgb, var(--ui-signal-record) 55%, var(--ui-color-border-strong));
  border-radius: 3px;
  color: var(--ui-signal-record);
  background: color-mix(in srgb, var(--ui-signal-record) 9%, var(--ui-daw-control));
  font-size: var(--ui-type-size-control);
}
</style>
