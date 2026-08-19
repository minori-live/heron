<script setup lang="ts">
import { nextTick, shallowRef, useTemplateRef, watch } from "vue"

import UiTextInput from "./UiTextInput.vue"

const props = withDefaults(
  defineProps<{
    value: string
    label: string
    editLabel?: string
    disabled?: boolean
    emptyAllowed?: boolean
  }>(),
  {
    editLabel: undefined,
    disabled: false,
    emptyAllowed: false
  }
)
const emit = defineEmits<{
  commit: [value: string]
  cancel: []
}>()

const editing = shallowRef(false)
const draft = shallowRef("")
const input = useTemplateRef<{ focus: () => void; select: () => void }>("input")

watch(
  () => props.value,
  (value) => {
    if (!editing.value) draft.value = value
  },
  { immediate: true }
)

async function begin(): Promise<void> {
  if (props.disabled) return
  draft.value = props.value
  editing.value = true
  await nextTick()
  input.value?.focus()
  input.value?.select()
}

function commit(): void {
  if (!editing.value) return
  const value = draft.value.trim()
  if (!value && !props.emptyAllowed) return cancel()
  editing.value = false
  if (value !== props.value) emit("commit", value)
}

function cancel(): void {
  if (!editing.value) return
  editing.value = false
  draft.value = props.value
  emit("cancel")
}
</script>

<template>
  <span class="ui-inline-edit">
    <UiTextInput
      v-if="editing"
      ref="input"
      v-model="draft"
      class="ui-inline-edit__input"
      size="sm"
      :aria-label="props.editLabel ?? props.label"
      @blur="commit"
      @keydown.enter.stop.prevent="commit"
      @keydown.esc.stop.prevent="cancel"
      @pointerdown.stop
    />
    <button
      v-else
      class="ui-inline-edit__value"
      type="button"
      :aria-label="props.label"
      :disabled="props.disabled"
      @dblclick.stop.prevent="begin"
      @keydown.f2.stop.prevent="begin"
    >
      <slot :value="props.value">{{ props.value }}</slot>
    </button>
  </span>
</template>

<style scoped>
.ui-inline-edit {
  display: block;
  min-width: 0;
}

.ui-inline-edit__value {
  display: block;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  text-align: inherit;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: text;
}

.ui-inline-edit__value:disabled {
  cursor: default;
}

.ui-inline-edit__input {
  width: 100%;
  font: inherit;
}
</style>
