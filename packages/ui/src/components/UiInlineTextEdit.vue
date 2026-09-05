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
    density?: "standard" | "compact"
    inputType?: "text" | "number"
  }>(),
  {
    editLabel: undefined,
    disabled: false,
    emptyAllowed: false,
    density: "standard",
    inputType: "text"
  }
)
const emit = defineEmits<{
  commit: [value: string]
  cancel: []
}>()

const editing = shallowRef(false)
const draft = shallowRef("")
const input = useTemplateRef<{ focus: () => void; select: () => void }>("input")
const trigger = useTemplateRef<HTMLButtonElement>("trigger")

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

function restoreFocus(event?: Event): void {
  if (event instanceof KeyboardEvent) void nextTick(() => trigger.value?.focus())
}

function commit(event?: Event): void {
  if (!editing.value) return
  const value = draft.value.trim()
  if (!value && !props.emptyAllowed) return cancel(event)
  editing.value = false
  if (value !== props.value) emit("commit", value)
  restoreFocus(event)
}

function cancel(event?: Event): void {
  if (!editing.value) return
  editing.value = false
  draft.value = props.value
  emit("cancel")
  restoreFocus(event)
}
</script>

<template>
  <span
    class="ui-inline-edit"
    :class="{ 'ui-inline-edit--compact': props.density === 'compact' }"
    @pointerdown.stop
    @click.stop
  >
    <UiTextInput
      v-if="editing"
      ref="input"
      v-model="draft"
      class="ui-inline-edit__input"
      size="sm"
      :type="props.inputType"
      :aria-label="props.editLabel ?? props.label"
      @blur="commit"
      @keydown.enter.stop.prevent="commit"
      @keydown.esc.stop.prevent="cancel"
      @pointerdown.stop
    />
    <button
      v-else
      ref="trigger"
      class="ui-inline-edit__value"
      type="button"
      :aria-label="props.label"
      :disabled="props.disabled"
      @dblclick.stop.prevent="begin"
      @keydown.f2.stop.prevent="begin"
      @keydown.enter.stop.prevent="begin"
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
  height: 100%;
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

.ui-inline-edit--compact .ui-inline-edit__input {
  height: 100%;
  min-height: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  color: inherit;
  background: transparent;
  text-align: inherit;
  appearance: textfield;
}
.ui-inline-edit--compact .ui-inline-edit__input::-webkit-inner-spin-button,
.ui-inline-edit--compact .ui-inline-edit__input::-webkit-outer-spin-button {
  margin: 0;
  appearance: none;
}
</style>
