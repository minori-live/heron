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
    size="sm"
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
  border: 1px solid var(--line-soft);
  border-radius: 4px;
  color: var(--text-muted);
  background: var(--daw-control);
  font: var(--ui-type-weight-semibold) var(--ui-type-size-caption) var(--ui-type-family-data);
}
.global-tracks-toggle[aria-pressed="true"] {
  border-color: color-mix(in srgb, var(--accent) 58%, var(--line-soft));
  color: var(--text-primary);
  background: color-mix(in srgb, var(--accent) 13%, var(--daw-control));
}
.global-tracks-icon {
  display: grid;
  width: 13px;
  gap: 2px;
}
.global-tracks-icon i {
  display: block;
  height: 2px;
  border-radius: 1px;
  background: var(--text-faint);
}
.global-tracks-icon i:nth-child(1) {
  background: var(--ui-domain-color-65a8ff);
}
.global-tracks-icon i:nth-child(2) {
  background: var(--ui-domain-color-f2a65a);
}
.global-tracks-icon i:nth-child(3) {
  background: var(--ui-domain-color-b894ff);
}
</style>
