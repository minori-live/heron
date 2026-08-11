<script setup lang="ts">
import "driver.js/dist/driver.css"

import { driver } from "driver.js"
import type { Driver } from "driver.js"
import { computed, nextTick, onMounted, onUnmounted, shallowRef, watch } from "vue"
import { storeToRefs } from "pinia"
import { useI18n } from "vue-i18n"
import { useRoute } from "vue-router"
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

const activeDriver = shallowRef<Driver | null>(null)
const dismissedThisSession = shallowRef(false)
let completedCurrentRun = false
let startPending = false
let manualRequestPending = false
let bodyObserver: MutationObserver | null = null

const autoStartEligible = computed(
  () =>
    route.name === "studio" &&
    session.value !== null &&
    settings.value?.tutorials.autoStart === true &&
    (settings.value.tutorials.completedVersions["studio-basics"] ?? 0) < STUDIO_BASICS_VERSION &&
    !dismissedThisSession.value
)

function hasBlockingSurface(): boolean {
  return document.querySelector('[aria-modal="true"], [data-tutorial-blocking-surface]') !== null
}

function targetIsVisible(selector: string): boolean {
  const element = document.querySelector<HTMLElement>(selector)
  return Boolean(element && element.getClientRects().length > 0)
}

function visibleSteps() {
  return studioBasicsSteps(t).filter((step) => {
    if (typeof step.element !== "string") return true
    return targetIsVisible(step.element)
  })
}

function destroyActive(): void {
  activeDriver.value?.destroy()
}

async function startStudioBasics(manual: boolean): Promise<void> {
  if (startPending || activeDriver.value) return
  if (route.name !== "studio" || session.value === null) return
  if (!manual && !autoStartEligible.value) return

  startPending = true
  await nextTick()
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  startPending = false

  if (activeDriver.value || route.name !== "studio" || session.value === null) return
  if (!manual && (!autoStartEligible.value || hasBlockingSurface())) return
  if (!targetIsVisible('[data-tutorial="studio-arrangement"]') || hasBlockingSurface()) return

  completedCurrentRun = false
  manualRequestPending = false
  const instance = driver({
    animate: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    allowClose: true,
    allowKeyboardControl: true,
    disableActiveInteraction: true,
    overlayClickBehavior: "close",
    showProgress: true,
    skipMissingElement: true,
    waitForElement: 1_000,
    stagePadding: 8,
    stageRadius: 7,
    popoverClass: "heron-tutorial-popover",
    progressText: t("tutorials.progress"),
    nextBtnText: t("tutorials.actions.next"),
    prevBtnText: t("tutorials.actions.previous"),
    doneBtnText: t("tutorials.actions.done"),
    steps: visibleSteps(),
    onDoneClick: () => {
      completedCurrentRun = true
      dismissedThisSession.value = true
      void settingsStore.markTutorialCompleted("studio-basics", STUDIO_BASICS_VERSION)
      instance.destroy()
    },
    onDestroyed: () => {
      if (!completedCurrentRun) dismissedThisSession.value = true
      if (activeDriver.value === instance) activeDriver.value = null
    }
  })
  activeDriver.value = instance
  instance.drive()
}

watch(
  autoStartEligible,
  (eligible) => {
    if (eligible) void startStudioBasics(false)
    else if (activeDriver.value && route.name !== "studio") destroyActive()
  },
  { immediate: true }
)

watch(studioBasicsRequest, () => {
  manualRequestPending = true
  void startStudioBasics(true)
})

watch(
  () => route.name,
  (name) => {
    if (name !== "studio") {
      manualRequestPending = false
      destroyActive()
    }
  }
)

onMounted(() => {
  bodyObserver = new MutationObserver(() => {
    if (manualRequestPending && !hasBlockingSurface()) void startStudioBasics(true)
    else if (autoStartEligible.value && !hasBlockingSurface()) void startStudioBasics(false)
  })
  bodyObserver.observe(document.body, { childList: true, subtree: true })
})

onUnmounted(() => {
  bodyObserver?.disconnect()
  bodyObserver = null
  destroyActive()
})
</script>

<template><div hidden aria-hidden="true" /></template>
