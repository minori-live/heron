<script setup lang="ts">
import { computed } from "vue"
import { SplitSquareHorizontal, Trash2 } from "@lucide/vue"
import { UiButton, UiNumberInput, UiSelect } from "@heron/ui"
import { evaluateAbsoluteMidiTransform } from "@heron/contracts"
import type { MidiAbsoluteTransformProfile } from "@heron/contracts"

const props = defineProps<{ modelValue: MidiAbsoluteTransformProfile }>()
const emit = defineEmits<{ "update:modelValue": [value: MidiAbsoluteTransformProfile] }>()

const path = computed(() =>
  Array.from({ length: 128 }, (_, value) => {
    const output = evaluateAbsoluteMidiTransform(props.modelValue, value / 127)
    return `${value === 0 ? "M" : "L"} ${value} ${127 - output * 127}`
  }).join(" ")
)

function updateSegment(index: number, field: string, raw: string): void {
  const segments = props.modelValue.segments.map((segment, candidate) =>
    candidate === index ? { ...segment, [field]: Number(raw) } : segment
  )
  emit("update:modelValue", { ...props.modelValue, segments })
}

function splitLastSegment(): void {
  const segments = structuredClone(props.modelValue.segments)
  const last = segments.pop()
  if (!last) return
  const inputMiddle = (last.inputStart + last.inputEnd) / 2
  const outputMiddle = (last.outputStart + last.outputEnd) / 2
  segments.push(
    { ...last, inputEnd: inputMiddle, outputEnd: outputMiddle },
    { ...last, inputStart: inputMiddle, outputStart: outputMiddle }
  )
  emit("update:modelValue", { ...props.modelValue, segments })
}

function removeLastSegment(): void {
  if (props.modelValue.segments.length < 2) return
  const segments = structuredClone(props.modelValue.segments)
  const removed = segments.pop()!
  const last = segments.at(-1)!
  last.inputEnd = 1
  last.outputEnd = removed.outputEnd
  emit("update:modelValue", { ...props.modelValue, segments })
}
</script>

<template>
  <div class="curve-editor">
    <div class="curve-stage">
      <span class="axis-label axis-label-output">Output</span>
      <svg viewBox="0 0 127 127" role="img" aria-label="MIDI transform curve preview">
        <path class="curve-grid" d="M 0 127 L 127 0 M 0 63.5 L 127 63.5 M 63.5 0 L 63.5 127" />
        <path class="curve-line" :d="path" />
      </svg>
      <span class="axis-label axis-label-input">MIDI input 0–127</span>
    </div>
    <div class="curve-samples" aria-label="0 through 127 sample preview">
      <span v-for="value in 128" :key="value" :title="`${value - 1}`" />
    </div>
    <table class="segment-table">
      <thead>
        <tr>
          <th>Input</th>
          <th>Output</th>
          <th>Shape</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(segment, index) in modelValue.segments" :key="index">
          <td>
            <UiNumberInput
              :aria-label="`Segment ${index + 1} input start`"
              size="compact"
              :min="0"
              :max="1"
              :step="0.01"
              :model-value="segment.inputStart"
              @update:model-value="updateSegment(index, 'inputStart', String($event ?? 0))"
            />
            <UiNumberInput
              :aria-label="`Segment ${index + 1} input end`"
              size="compact"
              :min="0"
              :max="1"
              :step="0.01"
              :model-value="segment.inputEnd"
              @update:model-value="updateSegment(index, 'inputEnd', String($event ?? 0))"
            />
          </td>
          <td>
            <UiNumberInput
              :aria-label="`Segment ${index + 1} output start`"
              size="compact"
              :min="0"
              :max="1"
              :step="0.01"
              :model-value="segment.outputStart"
              @update:model-value="updateSegment(index, 'outputStart', String($event ?? 0))"
            />
            <UiNumberInput
              :aria-label="`Segment ${index + 1} output end`"
              size="compact"
              :min="0"
              :max="1"
              :step="0.01"
              :model-value="segment.outputEnd"
              @update:model-value="updateSegment(index, 'outputEnd', String($event ?? 0))"
            />
          </td>
          <td>
            <UiSelect
              :aria-label="`Segment ${index + 1} shape`"
              size="compact"
              :model-value="segment.kind"
              @update:model-value="
                emit('update:modelValue', {
                  ...modelValue,
                  segments: modelValue.segments.map((item, candidate) =>
                    candidate === index
                      ? {
                          ...item,
                          kind: $event as typeof item.kind
                        }
                      : item
                  )
                })
              "
            >
              <option value="linear">Linear</option>
              <option value="exponential">Exponential</option>
              <option value="logarithmic">Logarithmic</option>
              <option value="s-curve">S-curve</option>
              <option value="step">Step</option>
            </UiSelect>
          </td>
          <td>
            <UiNumberInput
              :aria-label="`Segment ${index + 1} amount`"
              size="compact"
              :step="0.1"
              :model-value="segment.amount ?? 4"
              @update:model-value="updateSegment(index, 'amount', String($event ?? 4))"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <div class="segment-actions">
      <UiButton size="sm" variant="secondary" @click="splitLastSegment">
        <SplitSquareHorizontal :size="14" /> Split last segment
      </UiButton>
      <UiButton
        size="sm"
        variant="ghost"
        :disabled="modelValue.segments.length < 2"
        @click="removeLastSegment"
      >
        <Trash2 :size="14" /> Remove last segment
      </UiButton>
    </div>
  </div>
</template>

<style scoped>
.curve-editor {
  display: grid;
  gap: 12px;
}

.curve-stage {
  position: relative;
  padding: 18px 12px 22px 36px;
  border: 1px solid var(--line-soft);
  border-radius: 7px;
  background: var(--surface-sunken);
}

.curve-stage svg {
  display: block;
  width: 100%;
  max-height: 230px;
  aspect-ratio: 1.8;
}

.curve-grid {
  fill: none;
  stroke: var(--line-strong);
  stroke-width: 0.5;
}

.curve-line {
  fill: none;
  stroke: var(--accent);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

.axis-label {
  position: absolute;
  color: var(--text-faint);
  font: var(--ui-type-size-micro) var(--ui-type-family-data);
  letter-spacing: var(--ui-type-tracking-wide);
  text-transform: uppercase;
}

.axis-label-output {
  top: 50%;
  left: 7px;
  transform: rotate(-90deg) translateX(-50%);
  transform-origin: left top;
}

.axis-label-input {
  right: 12px;
  bottom: 6px;
}

.curve-samples {
  display: grid;
  grid-template-columns: repeat(128, 1fr);
  height: 5px;
  overflow: hidden;
  border-radius: 3px;
}

.curve-samples span {
  background: var(--accent);
  opacity: 0.64;
}

.segment-table {
  width: 100%;
  border-collapse: collapse;
}

.segment-table th,
.segment-table td {
  text-align: left;
  padding: 6px;
  border-bottom: 1px solid var(--line-soft);
}

.segment-table th {
  color: var(--text-faint);
  font: var(--ui-type-size-caption) var(--ui-type-family-data);
  font-weight: var(--ui-type-weight-medium);
}

.segment-table td:first-child,
.segment-table td:nth-child(2) {
  display: grid;
  grid-template-columns: repeat(2, minmax(60px, 1fr));
  gap: 4px;
}

.segment-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
