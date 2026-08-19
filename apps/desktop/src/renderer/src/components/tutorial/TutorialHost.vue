<script setup lang="ts">
import { computed, shallowRef, watch } from "vue"
import { storeToRefs } from "pinia"
import { useI18n } from "vue-i18n"
import { useRoute } from "vue-router"
import { UiGuidedTour } from "@heron/ui"
import { useTutorialController } from "../../composables/useTutorialController"
import { useApplicationSettingsStore } from "../../stores/applicationSettings"
import { useProjectStore } from "../../stores/project"
import { STUDIO_BASICS_VERSION, studioBasicsSteps } from "../../tutorials/studioBasics"

const route = useRoute()
const { t } = useI18n()
const settingsStore = useApplicationSettingsStore()
const projectStore = useProjectStore()
const { settings } = storeToRefs(settingsStore)
const { session } = storeToRefs(projectStore)
const { studioBasicsRequest } = useTutorialController()
const dismissedThisSession = shallowRef(false)
const manual = shallowRef(false)

const autoStartEligible = computed(
  () =>
    route.name === "studio" &&
    session.value !== null &&
    settings.value?.tutorials.autoStart === true &&
    (settings.value.tutorials.completedVersions["studio-basics"] ?? 0) < STUDIO_BASICS_VERSION &&
    !dismissedThisSession.value
)
const active = computed(() => manual.value || autoStartEligible.value)
const steps = computed(() => studioBasicsSteps(t))

watch(studioBasicsRequest, () => {
  manual.value = route.name === "studio" && session.value !== null
})
watch(
  () => route.name,
  (name) => {
    if (name !== "studio") manual.value = false
  }
)

function cancel(): void {
  manual.value = false
  dismissedThisSession.value = true
}
function complete(): void {
  cancel()
  void settingsStore.markTutorialCompleted("studio-basics", STUDIO_BASICS_VERSION)
}
</script>

<template>
  <UiGuidedTour
    :active="active"
    :steps="steps"
    :progress-label="t('tutorials.progress')"
    :next-label="t('tutorials.actions.next')"
    :previous-label="t('tutorials.actions.previous')"
    :done-label="t('tutorials.actions.done')"
    @complete="complete"
    @cancel="cancel"
    @unavailable="cancel"
  />
</template>
