<script setup lang="ts">
const emit = defineEmits<{
  submit: []
}>()

function submit(): void {
  emit("submit")
}
</script>

<template>
  <form @submit.prevent="submit">
    <slot />
  </form>
</template>
