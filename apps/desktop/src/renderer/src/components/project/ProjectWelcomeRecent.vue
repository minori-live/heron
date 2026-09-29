<script setup lang="ts">
import type { ApplicationSettings } from "@heron/contracts"
import { useI18n } from "vue-i18n"
import { UiActionRow, UiButton } from "@heron/ui"

const props = defineProps<{
  projects: ApplicationSettings["recentProjects"]
  busy: boolean
}>()

const emit = defineEmits<{
  open: [path?: string]
}>()

const { t } = useI18n()
</script>

<template>
  <section class="welcome-recent" aria-labelledby="recent-projects-heading">
    <div class="welcome-recent__heading">
      <h2 id="recent-projects-heading">{{ t("welcome.recentProjects") }}</h2>
      <UiButton size="sm" variant="ghost" :disabled="props.busy" @click="emit('open')">
        {{ t("welcome.openAnother") }}
      </UiButton>
    </div>

    <div v-if="props.projects.length" class="welcome-recent__list">
      <UiActionRow
        v-for="recent in props.projects"
        :key="recent.path"
        class="recent-item"
        :label="recent.name"
        :description="
          t('welcome.recentKindPath', {
            kind: recent.kind === 'live' ? 'Live' : 'Studio',
            path: recent.path
          })
        "
        :disabled="props.busy"
        @activate="emit('open', recent.path)"
      >
        <template #leading
          ><span class="recent-item__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M3.5 7.5h6l2-2h9v13h-17z" />
              <path d="M3.5 9.5h17" />
            </svg> </span
        ></template>
        <template #trailing
          ><svg class="recent-item__arrow" aria-hidden="true" viewBox="0 0 20 20">
            <path d="M4 10h12M12 6l4 4-4 4" /></svg
        ></template>
      </UiActionRow>
    </div>

    <p v-else class="welcome-recent__empty">{{ t("welcome.noRecent") }}</p>
  </section>
</template>

<style scoped>
.welcome-recent {
  padding-top: clamp(24px, 3.5vh, 38px);
}

.welcome-recent__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.welcome-recent__heading h2 {
  margin: 0;
  color: var(--ui-color-text-muted);
  font: var(--ui-type-weight-bold) var(--ui-font-size-xs) / var(--ui-type-leading-tight)
    var(--ui-type-family-data);
  letter-spacing: var(--ui-type-tracking-widest);
  text-transform: uppercase;
}

.welcome-recent__heading > button {
  min-height: 32px;
  padding: 0;
  border: 0;
  color: var(--ui-color-action);
  background: transparent;
  font-size: var(--ui-font-size-xs);
  transition: color var(--ui-motion-fast) var(--ui-ease-standard);
}

.welcome-recent__heading > button:disabled {
  cursor: wait;
  opacity: 0.5;
}

.welcome-recent__list {
  display: grid;
  max-height: min(31vh, 260px);
  gap: 6px;
  margin-top: 16px;
  padding: 2px;
  overflow: auto;
}

.recent-item {
  display: grid;
  min-width: 0;
  grid-template-columns: 34px minmax(0, 1fr) 18px;
  align-items: center;
  gap: 12px;
  padding: 11px 10px;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-md);
  color: var(--ui-color-text-muted);
  background: transparent;
  text-align: left;
  transition:
    border-color var(--ui-motion-fast) var(--ui-ease-standard),
    background var(--ui-motion-fast) var(--ui-ease-standard),
    transform var(--ui-motion-fast) var(--ui-ease-standard);
}

.recent-item:disabled {
  cursor: wait;
  opacity: 0.55;
}

.recent-item__icon {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid var(--ui-color-border);
  border-radius: var(--ui-radius-md);
  color: var(--ui-color-text-subtle);
  background: var(--ui-color-surface-sunken);
}

.recent-item__icon svg {
  width: 17px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.4;
}

.recent-item__copy {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.recent-item__copy strong {
  overflow: hidden;
  font-size: var(--ui-font-size-sm);
  font-weight: var(--ui-type-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-item__copy small {
  overflow: hidden;
  color: var(--ui-color-text-subtle);
  font: var(--ui-font-size-xs) var(--ui-type-family-data);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-item__arrow {
  width: 17px;
  fill: none;
  stroke: var(--ui-color-text-subtle);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.4;
  transition: transform var(--ui-motion-fast) var(--ui-ease-standard);
}

.welcome-recent__empty {
  margin: 16px 0 0;
  padding: 18px;
  border: 1px dashed var(--ui-color-border);
  border-radius: var(--ui-radius-md);
  color: var(--ui-color-text-subtle);
  font-size: var(--ui-font-size-sm);
  line-height: var(--ui-type-leading-relaxed);
}
</style>
