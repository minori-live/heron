<script setup lang="ts">
import "driver.js/dist/driver.css"
import { driver, type Driver } from "driver.js"
import { nextTick, onBeforeUnmount, shallowRef, watch } from "vue"
import type { UiTourStep } from "../types"

const props = withDefaults(
  defineProps<{
    active: boolean
    steps: readonly UiTourStep[]
    progressLabel: string
    nextLabel: string
    previousLabel: string
    doneLabel: string
  }>(),
  {}
)
const emit = defineEmits<{ complete: []; cancel: []; unavailable: [] }>()
const activeDriver = shallowRef<Driver>()
let completed = false

function visibleSteps(): UiTourStep[] {
  return props.steps.filter(
    (step) => !step.target || document.querySelector(step.target)?.getClientRects().length
  )
}

async function start(): Promise<void> {
  if (!props.active || activeDriver.value) return
  await nextTick()
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  const steps = visibleSteps()
  if (steps.length === 0) return emit("unavailable")
  completed = false
  const instance = driver({
    animate:
      !matchMedia("(prefers-reduced-motion: reduce)").matches &&
      !document.querySelector('[data-ui-motion="disabled"]'),
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
    progressText: props.progressLabel,
    nextBtnText: props.nextLabel,
    prevBtnText: props.previousLabel,
    doneBtnText: props.doneLabel,
    steps: steps.map((step) => ({
      element: step.target,
      popover: {
        title: step.title,
        description: step.description,
        side: step.placement,
        align: step.align
      }
    })),
    onDoneClick: () => {
      completed = true
      emit("complete")
      instance.destroy()
    },
    onDestroyed: () => {
      activeDriver.value = undefined
      if (!completed) emit("cancel")
    }
  })
  activeDriver.value = instance
  instance.drive()
}

watch(
  () => props.active,
  (active) => (active ? void start() : activeDriver.value?.destroy()),
  { immediate: true }
)
watch(
  () => props.steps,
  () => {
    if (props.active) {
      activeDriver.value?.destroy()
      void start()
    }
  },
  { deep: true }
)
onBeforeUnmount(() => activeDriver.value?.destroy())
</script>

<template><span hidden aria-hidden="true" /></template>
