<script setup lang="ts">
import { computed } from "vue"
import { faApple, faLinux, faWindows } from "@fortawesome/free-brands-svg-icons"

const props = defineProps<{ name: "Windows" | "macOS" | "Linux" }>()

const icons = { Windows: faWindows, macOS: faApple, Linux: faLinux }
const icon = computed(() => icons[props.name].icon)
const viewBox = computed(() => `0 0 ${icon.value[0]} ${icon.value[1]}`)
const paths = computed(() => (typeof icon.value[4] === "string" ? [icon.value[4]] : icon.value[4]))
</script>

<template>
  <svg
    :viewBox="viewBox"
    width="1em"
    height="1em"
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
  >
    <desc>
      Font Awesome Free by Fonticons, Inc. (https://fontawesome.com), licensed under CC BY 4.0
      (https://creativecommons.org/licenses/by/4.0/).
    </desc>
    <path v-for="path in paths" :key="path" :d="path" />
  </svg>
</template>
