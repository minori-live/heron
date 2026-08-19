<script setup lang="ts">
const props = defineProps<{ label: string; selected?: boolean }>()
const emit = defineEmits<{ select: [] }>()
</script>

<template>
  <article
    class="ui-mixer-slot"
    :class="{ 'ui-mixer-slot--selected': props.selected }"
    :aria-label="props.label"
    :aria-current="props.selected ? 'true' : undefined"
    @pointerdown="emit('select')"
  >
    <slot />
  </article>
</template>

<style scoped>
.ui-mixer-slot {
  position: relative;
  min-width: 0;
}
.ui-mixer-slot--selected {
  box-shadow: 3px 0 0 var(--ui-color-action) inset;
}
</style>
