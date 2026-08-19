<script setup lang="ts">
import { useAttrs, useTemplateRef } from "vue"

import type { UiControlSize } from "../types"

defineOptions({ inheritAttrs: false })

const model = defineModel<string>({ default: "" })
const props = withDefaults(
  defineProps<{
    size?: UiControlSize
    invalid?: boolean
    resize?: "none" | "vertical" | "both"
  }>(),
  {
    size: "md",
    invalid: false,
    resize: "vertical"
  }
)
const attrs = useAttrs()
const textarea = useTemplateRef<HTMLTextAreaElement>("textarea")
const emit = defineEmits<{ submitShortcut: [] }>()

function handleKeydown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault()
    emit("submitShortcut")
  }
}

defineExpose({ focus: () => textarea.value?.focus() })
</script>

<template>
  <textarea
    ref="textarea"
    v-bind="attrs"
    v-model="model"
    class="ui-textarea"
    :class="[`ui-textarea--${props.size}`, `ui-textarea--resize-${props.resize}`]"
    :aria-invalid="props.invalid || undefined"
    @keydown="handleKeydown"
  />
</template>

<style scoped>
.ui-textarea {
  box-sizing: border-box;
  min-width: 0;
  width: 100%;
  border: 1px solid var(--ui-color-border);
  border-radius: var(--ui-radius-md);
  color: var(--ui-color-text);
  background: var(--ui-color-control);
  font-family: var(--ui-type-family-interface);
  line-height: var(--ui-type-leading-normal);
}

.ui-textarea:hover:not(:disabled) {
  border-color: var(--ui-color-border-strong);
}

.ui-textarea:focus {
  border-color: var(--ui-color-focus);
}

.ui-textarea[aria-invalid="true"] {
  border-color: var(--ui-color-danger);
}

.ui-textarea:disabled {
  cursor: not-allowed;
  opacity: var(--ui-opacity-disabled);
}

.ui-textarea--sm {
  min-height: calc(var(--ui-control-sm) * 2);
  padding: var(--ui-space-2);
  font-size: var(--ui-type-size-control);
}

.ui-textarea--md {
  min-height: calc(var(--ui-control-md) * 3);
  padding: var(--ui-space-3);
  font-size: var(--ui-type-size-body-compact);
}

.ui-textarea--lg {
  min-height: calc(var(--ui-control-lg) * 4);
  padding: var(--ui-space-4);
  font-size: var(--ui-type-size-label);
}

.ui-textarea--resize-none {
  resize: none;
}

.ui-textarea--resize-vertical {
  resize: vertical;
}

.ui-textarea--resize-both {
  resize: both;
}
</style>
