<script setup lang="ts">
import { useI18n } from "vue-i18n"
import { Plug, Save } from "@lucide/vue"
import { UiButton, UiEmptyState, UiSelect, UiTextInput } from "@heron/ui"
import type { PluginParameterInfo, ProjectGraphSnapshot } from "@heron/contracts"

const { t } = useI18n()

const props = defineProps<{
  plugins: ProjectGraphSnapshot["plugins"]
  parameters: Readonly<Record<string, readonly PluginParameterInfo[] | undefined>>
  aliasDrafts: Readonly<Record<string, string | undefined>>
}>()

const emit = defineEmits<{
  updateAlias: [instanceId: string, value: string]
  saveAlias: [instanceId: string]
  chooseParameter: [alias: string, parameterKey: string]
}>()

function availableParameters(instanceId: string): readonly PluginParameterInfo[] {
  return (props.parameters[instanceId] ?? []).filter(
    (parameter) => !parameter.hidden && !parameter.readOnly && parameter.automatable !== false
  )
}
</script>

<template>
  <div v-if="props.plugins.length" class="alias-list">
    <article v-for="plugin in props.plugins" :key="plugin.id" class="alias-row">
      <span class="plugin-mark"><Plug :size="15" /></span>
      <span class="plugin-copy">
        <strong>{{ plugin.descriptor.name }}</strong>
        <small>{{ plugin.descriptor.vendor }} · {{ plugin.locator.format }}</small>
      </span>
      <UiTextInput
        size="sm"
        :aria-label="t('midiSettings.alias.aria', { name: plugin.descriptor.name })"
        :model-value="props.aliasDrafts[plugin.id] ?? plugin.controlAlias ?? ''"
        placeholder="lowercase-slug"
        @update:model-value="emit('updateAlias', plugin.id, $event)"
      />
      <UiButton size="sm" variant="secondary" @click="emit('saveAlias', plugin.id)">
        <Save :size="14" /> {{ t("midiSettings.alias.save") }}
      </UiButton>
      <div v-if="plugin.controlAlias" class="parameter-picker">
        <span>{{ t("midiSettings.alias.browser") }}</span>
        <UiSelect
          size="sm"
          :aria-label="t('midiSettings.alias.browser')"
          model-value=""
          :disabled="availableParameters(plugin.id).length === 0"
          @update:model-value="emit('chooseParameter', plugin.controlAlias!, $event)"
        >
          <option value="">
            {{
              availableParameters(plugin.id).length
                ? t("midiSettings.alias.choose")
                : t("midiSettings.alias.open")
            }}
          </option>
          <option
            v-for="parameter in availableParameters(plugin.id)"
            :key="parameter.parameterKey"
            :value="parameter.parameterKey"
          >
            {{ parameter.title }}
          </option>
        </UiSelect>
      </div>
    </article>
  </div>

  <UiEmptyState
    v-else
    :title="t('midiSettings.alias.empty')"
    :description="t('midiSettings.alias.emptyDescription')"
  >
    <template #icon><Plug :size="20" /></template>
  </UiEmptyState>
</template>

<style scoped>
.alias-list {
  display: grid;
  gap: 8px;
}

.alias-row {
  display: grid;
  grid-template-columns: 30px minmax(140px, 1fr) minmax(130px, 0.8fr) auto;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--line-soft);
  border-radius: 7px;
  background: var(--surface-1);
}

.plugin-mark {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 5px;
  color: var(--accent);
  background: var(--surface-sunken);
}

.plugin-copy {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.plugin-copy strong {
  overflow: hidden;
  font-size: var(--ui-type-size-body-compact);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plugin-copy small,
.parameter-picker > span {
  color: var(--text-faint);
  font: var(--ui-type-size-caption) var(--ui-type-family-data);
}

.parameter-picker {
  grid-column: 2 / -1;
  display: grid;
  grid-template-columns: minmax(120px, 0.45fr) minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding-top: 9px;
  border-top: 1px solid var(--line-soft);
}

@media (max-width: 760px) {
  .alias-row {
    grid-template-columns: 30px minmax(0, 1fr) auto;
  }

  .alias-row > :deep(.ui-input) {
    grid-column: 1 / -1;
  }

  .parameter-picker {
    grid-column: 1 / -1;
    grid-template-columns: 1fr;
  }
}
</style>
