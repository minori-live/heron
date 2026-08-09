<script setup lang="ts">
import { computed } from "vue"
import { SplitSquareHorizontal, Trash2 } from "@lucide/vue"
import { UiButton, UiCurveEditor, UiNumberInput, UiSelect } from "@heron/ui"
import type { UiCurveHandle, UiCurveStroke } from "@heron/ui"
import { evaluateAbsoluteMidiTransform } from "@heron/contracts"
import type { MidiAbsoluteTransformProfile } from "@heron/contracts"

const props = defineProps<{ modelValue: MidiAbsoluteTransformProfile }>()
const emit = defineEmits<{ "update:modelValue": [value: MidiAbsoluteTransformProfile] }>()

function copySegments() {
  return props.modelValue.segments.map((segment) => ({ ...segment }))
}

const curves = computed<UiCurveStroke[]>(() =>
  props.modelValue.segments.map((segment, index) => {
    const sampleCount = Math.max(2, Math.round((segment.inputEnd - segment.inputStart) * 127) + 1)
    return {
      id: `segment-${index}`,
      points: Array.from({ length: sampleCount }, (_, sample) => {
        const x =
          segment.inputStart +
          (segment.inputEnd - segment.inputStart) * (sample / (sampleCount - 1))
        return {
          x,
          y: evaluateAbsoluteMidiTransform({ ...props.modelValue, segments: [segment] }, x)
        }
      })
    }
  })
)

const handles = computed<UiCurveHandle[]>(() => {
  const segments = props.modelValue.segments
  const result: UiCurveHandle[] = []
  const first = segments[0]
  if (!first) return result
  result.push({
    id: "outer-start",
    label: "Curve start",
    x: first.inputStart,
    y: first.outputStart,
    minX: first.inputStart,
    maxX: first.inputStart
  })
  for (let index = 1; index < segments.length; index += 1) {
    const before = segments[index - 1]!
    const after = segments[index]!
    const constraints = {
      x: before.inputEnd,
      minX: before.inputStart + 0.001,
      maxX: after.inputEnd - 0.001
    }
    if (Math.abs(before.outputEnd - after.outputStart) < 0.000_001) {
      result.push({
        id: `boundary-${index}`,
        label: `Segment ${index} to ${index + 1} boundary`,
        ...constraints,
        y: before.outputEnd
      })
    } else {
      result.push(
        {
          id: `boundary-${index}-before`,
          label: `Segment ${index} end`,
          ...constraints,
          y: before.outputEnd
        },
        {
          id: `boundary-${index}-after`,
          label: `Segment ${index + 1} start`,
          ...constraints,
          y: after.outputStart,
          tone: "secondary"
        }
      )
    }
  }
  const last = segments.at(-1)!
  result.push({
    id: "outer-end",
    label: "Curve end",
    x: last.inputEnd,
    y: last.outputEnd,
    minX: last.inputEnd,
    maxX: last.inputEnd
  })
  return result
})

function updateSegment(index: number, field: string, raw: string): void {
  const segments = props.modelValue.segments.map((segment, candidate) =>
    candidate === index ? { ...segment, [field]: Number(raw) } : segment
  )
  emit("update:modelValue", { ...props.modelValue, segments })
}

function moveCurveHandle(change: { id: string; x: number; y: number }): void {
  const segments = copySegments()
  if (change.id === "outer-start") {
    if (segments[0]) segments[0].outputStart = change.y
  } else if (change.id === "outer-end") {
    if (segments.at(-1)) segments.at(-1)!.outputEnd = change.y
  } else {
    const match = /^boundary-(\d+)(?:-(before|after))?$/u.exec(change.id)
    if (!match) return
    const index = Number(match[1])
    const before = segments[index - 1]
    const after = segments[index]
    if (!before || !after) return
    before.inputEnd = change.x
    after.inputStart = change.x
    if (match[2] === "before") before.outputEnd = change.y
    else if (match[2] === "after") after.outputStart = change.y
    else {
      before.outputEnd = change.y
      after.outputStart = change.y
    }
  }
  emit("update:modelValue", { ...props.modelValue, segments })
}

function splitLastSegment(): void {
  const segments = copySegments()
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
  const segments = copySegments()
  const removed = segments.pop()!
  const last = segments.at(-1)!
  last.inputEnd = 1
  last.outputEnd = removed.outputEnd
  emit("update:modelValue", { ...props.modelValue, segments })
}
</script>

<template>
  <div class="curve-editor">
    <UiCurveEditor
      :curves="curves"
      :handles="handles"
      x-label="MIDI input 0–127"
      y-label="Normalized output"
      @move-handle="moveCurveHandle"
    />
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
