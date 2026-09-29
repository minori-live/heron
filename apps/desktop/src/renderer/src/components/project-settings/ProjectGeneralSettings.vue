<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import { intlLocale } from "../../i18n"
import { UiNumberInput, UiSelect, UiTextInput } from "@heron/ui"
import { PROJECT_SAMPLE_RATES } from "@heron/contracts"
import type { ProjectConfiguration } from "@heron/contracts"
import SettingsPage from "../settings/SettingsPage.vue"
import SettingsSection from "../settings/SettingsSection.vue"

const { t, locale } = useI18n()
const formattingLocale = computed(() => intlLocale(locale.value))
const configuration = defineModel<ProjectConfiguration>({ required: true })

function update(patch: Partial<ProjectConfiguration>): void {
  configuration.value = { ...configuration.value, ...patch }
}
</script>

<template>
  <SettingsPage
    :category="t('settings.project.general.category')"
    :page="t('settings.project.general.page')"
    :title="t('settings.project.general.title')"
    :description="t('settings.project.general.description')"
  >
    <SettingsSection
      :eyebrow="t('settings.project.general.identity.eyebrow')"
      :title="t('settings.project.general.identity.title')"
      :description="t('settings.project.general.identity.description')"
    >
      <label class="field">
        <span>{{ t("settings.project.general.identity.nameLabel") }}</span>
        <UiTextInput
          :model-value="configuration.name"
          required
          @update:model-value="update({ name: $event })"
        />
      </label>
    </SettingsSection>

    <SettingsSection
      :eyebrow="t('settings.project.general.sessionFormat.eyebrow')"
      :title="t('settings.project.general.sessionFormat.title')"
      :description="t('settings.project.general.sessionFormat.description')"
    >
      <div class="field-grid">
        <label class="field wide">
          <span>{{ t("settings.project.general.sessionFormat.sampleRate") }}</span>
          <UiSelect
            :model-value="String(configuration.sampleRate)"
            size="md"
            @update:model-value="
              update({ sampleRate: Number($event) as ProjectConfiguration['sampleRate'] })
            "
          >
            <option v-for="rate in PROJECT_SAMPLE_RATES" :key="rate" :value="String(rate)">
              {{ rate.toLocaleString(formattingLocale) }} Hz
            </option>
          </UiSelect>
          <small>{{ t("settings.project.general.sessionFormat.sampleRateHint") }}</small>
        </label>
        <label class="field">
          <span>{{ t("settings.project.general.sessionFormat.meterNumerator") }}</span>
          <UiNumberInput
            :model-value="configuration.timeSignatureNumerator"
            :min="1"
            :max="32"
            size="md"
            @update:model-value="$event !== null && update({ timeSignatureNumerator: $event })"
          />
        </label>
        <label class="field">
          <span>{{ t("settings.project.general.sessionFormat.meterDenominator") }}</span>
          <UiSelect
            :model-value="String(configuration.timeSignatureDenominator)"
            size="md"
            @update:model-value="update({ timeSignatureDenominator: Number($event) })"
          >
            <option v-for="value in [1, 2, 4, 8, 16, 32]" :key="value" :value="String(value)">
              {{ value }}
            </option>
          </UiSelect>
        </label>
      </div>
    </SettingsSection>

    <SettingsSection
      :eyebrow="t('settings.project.general.waveforms.eyebrow')"
      :title="t('settings.project.general.waveforms.title')"
      :description="t('settings.project.general.waveforms.description')"
    >
      <label class="field">
        <span>{{ t("settings.project.general.waveforms.channelsLabel") }}</span>
        <UiSelect
          :model-value="configuration.waveformDisplayMode"
          size="md"
          @update:model-value="
            update({
              waveformDisplayMode: $event as ProjectConfiguration['waveformDisplayMode']
            })
          "
        >
          <option value="separate">{{ t("settings.project.general.waveforms.separate") }}</option>
          <option value="aggregate">{{ t("settings.project.general.waveforms.aggregate") }}</option>
        </UiSelect>
        <small>{{ t("settings.project.general.waveforms.separateHint") }}</small>
      </label>
    </SettingsSection>
  </SettingsPage>
</template>

<style scoped>
.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.field.wide {
  grid-column: 1 / -1;
}

.field {
  display: grid;
  align-content: start;
  gap: 7px;
  color: var(--text-muted);
  font: var(--ui-type-weight-bold) var(--ui-type-size-caption) var(--ui-type-family-data);
  letter-spacing: var(--ui-type-tracking-wide);
  text-transform: uppercase;
}

.field small {
  color: var(--text-faint);
  font: var(--ui-type-weight-regular) var(--ui-type-size-caption) var(--ui-type-family-data);
  letter-spacing: var(--ui-type-tracking-normal);
  line-height: var(--ui-type-leading-normal);
  text-transform: none;
}

@media (max-width: 1120px) {
  .field-grid {
    grid-template-columns: 1fr;
  }

  .field.wide {
    grid-column: auto;
  }
}
</style>
