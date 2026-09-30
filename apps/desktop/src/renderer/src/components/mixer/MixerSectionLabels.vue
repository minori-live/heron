<script setup lang="ts">
import { useI18n } from "vue-i18n"

const { t } = useI18n()
</script>

<template>
  <aside class="mixer-section-labels" aria-hidden="true">
    <span>{{ t("mixer.sections.input") }}</span>
    <span>{{ t("mixer.sections.audioFx") }}</span>
    <span>{{ t("mixer.sections.sends") }}</span>
    <span>{{ t("mixer.sections.output") }}</span>
    <span>{{ t("mixer.sections.group") }}</span>
    <span>{{ t("mixer.sections.automation") }}</span>
    <span>{{ t("mixer.sections.pan") }}</span>
    <span>{{ t("mixer.sections.volume") }}</span>
    <span>{{ t("mixer.sections.channel") }}</span>
  </aside>
</template>

<style scoped>
.mixer-section-labels {
  position: sticky;
  left: 0;
  z-index: var(--ui-z-local-header);
  display: grid;
  grid-template-rows:
    54px var(--plugin-section-height) var(--send-section-height) 44px 34px 34px 78px
    minmax(282px, 1fr) 40px;
  flex: 0 0 52px;
  min-width: 52px;
  height: 100%;
  min-height: calc(566px + var(--plugin-section-height) + var(--send-section-height));
  color: var(--ui-domain-mixer-label-ink);
  background: var(--ui-domain-mixer-section);
  box-shadow:
    1px 0 0 var(--ui-domain-mixer-label-edge),
    7px 0 14px var(--ui-domain-mixer-label-shadow);
}

.mixer-section-labels span {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 8px 0 4px;
  border-bottom: 1px solid var(--ui-domain-mixer-label-divider);
  font: var(--ui-type-weight-bold) var(--ui-type-size-caption) var(--ui-type-family-data);
  letter-spacing: var(--ui-type-tracking-wide);
  text-align: right;
}
</style>
