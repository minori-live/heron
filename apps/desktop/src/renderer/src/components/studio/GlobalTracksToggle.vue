<script setup lang="ts">
import { useI18n } from "vue-i18n"
import { UiButton } from "@heron/ui"

defineProps<{
  expanded: boolean
}>()

const emit = defineEmits<{
  toggle: []
}>()

const { t } = useI18n()
</script>

<template>
  <UiButton
    size="compact"
    variant="ghost"
    class="global-tracks-toggle"
    :aria-label="
      expanded
        ? t('studio.arrangement.hideGlobalTracksAria')
        : t('studio.arrangement.showGlobalTracksAria')
    "
    :aria-pressed="expanded"
    @click="emit('toggle')"
  >
    <span class="global-tracks-icon" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
    <span>{{ t("studio.arrangement.globalTracks") }}</span>
  </UiButton>
</template>

<style scoped>
.global-tracks-toggle {
  display: inline-flex;
  height: 27px;
  padding: 0 9px;
  align-items: center;
  gap: 7px;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-sm);
  color: var(--ui-color-text-subtle);
  background: var(--ui-color-fill);
}
.global-tracks-toggle[aria-pressed="true"] {
  color: var(--ui-color-action);
  background: color-mix(in srgb, var(--ui-color-action) 20%, transparent);
}
.global-tracks-icon {
  display: grid;
  width: 13px;
  gap: 2px;
}
.global-tracks-icon i {
  display: block;
  height: 2px;
  border-radius: var(--ui-radius-xs);
  background: var(--ui-color-text-faint);
}
.global-tracks-icon i:nth-child(1) {
  background: var(--ui-domain-lane-tempo);
}
.global-tracks-icon i:nth-child(2) {
  background: var(--ui-domain-lane-meter);
}
.global-tracks-icon i:nth-child(3) {
  background: var(--ui-domain-lane-key);
}
</style>
