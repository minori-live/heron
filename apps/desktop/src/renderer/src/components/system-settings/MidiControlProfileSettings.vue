<script setup lang="ts">
import { Copy, Plus, SlidersHorizontal } from "@lucide/vue"
import { UiActionRow, UiButton, UiField, UiNumberInput, UiTextInput } from "@heron/ui"
import type { MidiRelativeTransformProfile, MidiTransformProfile } from "@heron/contracts"
import MidiTransformCurveEditor from "./MidiTransformCurveEditor.vue"

const props = defineProps<{
  profiles: readonly MidiTransformProfile[]
}>()

const emit = defineEmits<{
  edit: [profile: MidiTransformProfile]
  save: []
  cancel: []
}>()

const draft = defineModel<MidiTransformProfile | null>("draft", { required: true })

function updateRelative(patch: Partial<MidiRelativeTransformProfile>): void {
  if (draft.value?.type !== "relative") return
  draft.value = { ...draft.value, ...patch }
}

function updateAcceleration(
  index: number,
  field: "eventsPerSecond" | "multiplier",
  value: number
): void {
  if (draft.value?.type !== "relative") return
  const acceleration = draft.value.acceleration.map((point, candidate) =>
    candidate === index ? { ...point, [field]: value } : point
  )
  updateRelative({ acceleration })
}

function addAccelerationPoint(): void {
  if (draft.value?.type !== "relative") return
  updateRelative({
    acceleration: [...draft.value.acceleration, { eventsPerSecond: 20, multiplier: 2 }]
  })
}

function removeAccelerationPoint(index: number): void {
  if (draft.value?.type !== "relative") return
  updateRelative({
    acceleration: draft.value.acceleration.filter((_, candidate) => candidate !== index)
  })
}
</script>

<template>
  <div class="profile-settings">
    <ul class="profile-list">
      <li v-for="profile in props.profiles" :key="profile.id">
        <UiActionRow
          :label="profile.name"
          :description="profile.type === 'absolute' ? 'Absolute curve' : 'Relative acceleration'"
          @activate="emit('edit', profile)"
        >
          <template #leading>
            <span class="profile-icon"><SlidersHorizontal :size="15" aria-hidden="true" /></span>
          </template>
          <template #trailing>
            <span class="profile-origin">{{ profile.builtin ? "Built in" : "Custom" }}</span>
            <Copy v-if="profile.builtin" :size="14" aria-label="Duplicate profile" />
            <span v-else class="edit-label">Edit</span>
          </template>
        </UiActionRow>
      </li>
    </ul>

    <div v-if="draft" class="profile-editor">
      <header class="profile-editor-header">
        <span>
          <small>{{
            draft.type === "absolute" ? "Absolute transform" : "Relative transform"
          }}</small>
          <strong>{{ draft.name || "Untitled profile" }}</strong>
        </span>
        <span class="draft-label">Draft</span>
      </header>

      <UiField label="Profile name">
        <template #default="slotProps">
          <UiTextInput :id="slotProps.controlId" v-model="draft.name" size="sm" />
        </template>
      </UiField>

      <MidiTransformCurveEditor v-if="draft.type === 'absolute'" v-model="draft" />

      <div v-else class="relative-editor">
        <UiField
          label="Base normalized step"
          description="Distance moved for one encoder increment before acceleration."
        >
          <template #default="slotProps">
            <UiNumberInput
              :id="slotProps.controlId"
              size="sm"
              :model-value="draft.baseStep"
              :min="0.000001"
              :max="1"
              :step="0.001"
              @update:model-value="updateRelative({ baseStep: $event ?? 0.001 })"
            />
          </template>
        </UiField>

        <div class="acceleration-table">
          <div class="acceleration-heading">
            <span>Events / second</span><span>Multiplier</span><span aria-hidden="true" />
          </div>
          <div v-for="(point, index) in draft.acceleration" :key="index" class="acceleration-row">
            <UiNumberInput
              size="sm"
              :aria-label="`Acceleration ${index + 1} event rate`"
              :model-value="point.eventsPerSecond"
              :min="0"
              @update:model-value="updateAcceleration(index, 'eventsPerSecond', $event ?? 0)"
            />
            <UiNumberInput
              size="sm"
              :aria-label="`Acceleration ${index + 1} multiplier`"
              :model-value="point.multiplier"
              :min="0.000001"
              :step="0.1"
              @update:model-value="updateAcceleration(index, 'multiplier', $event ?? 1)"
            />
            <UiButton size="sm" variant="ghost" @click="removeAccelerationPoint(index)"
              >Remove</UiButton
            >
          </div>
          <UiButton class="add-point" size="sm" variant="secondary" @click="addAccelerationPoint">
            <Plus :size="14" /> Add acceleration point
          </UiButton>
        </div>
      </div>

      <footer class="profile-actions">
        <UiButton size="sm" variant="secondary" @click="emit('cancel')">Cancel</UiButton>
        <UiButton size="sm" variant="primary" @click="emit('save')">Save profile</UiButton>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.profile-settings,
.profile-list,
.profile-editor,
.relative-editor,
.acceleration-table {
  display: grid;
}

.profile-settings,
.profile-list {
  gap: 8px;
}

.profile-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.profile-icon {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 5px;
  color: var(--accent);
  background: var(--surface-sunken);
}

.profile-editor-header span:first-child {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.profile-editor-header strong {
  color: var(--text-primary);
  font-size: var(--ui-type-size-body-compact);
}

.profile-editor-header small,
.profile-origin,
.edit-label,
.draft-label,
.acceleration-heading {
  color: var(--text-faint);
  font: var(--ui-type-size-caption) var(--ui-type-family-data);
}

.edit-label {
  color: var(--accent);
}

.profile-editor {
  gap: 16px;
  margin-top: 8px;
  padding: 14px;
  border: 1px solid var(--line-strong);
  border-radius: 7px;
  background: var(--surface-1);
}

.profile-editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line-soft);
}

.draft-label {
  padding: 3px 6px;
  border: 1px solid color-mix(in srgb, var(--accent) 36%, var(--line-soft));
  border-radius: 4px;
  color: var(--accent);
  text-transform: uppercase;
}

.relative-editor,
.acceleration-table {
  gap: 10px;
}

.acceleration-heading,
.acceleration-row {
  display: grid;
  grid-template-columns: minmax(100px, 1fr) minmax(100px, 1fr) auto;
  align-items: center;
  gap: 8px;
}

.acceleration-heading {
  padding: 0 2px;
}

.add-point {
  justify-self: start;
}

.profile-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 2px;
}

@media (max-width: 760px) {
  .profile-origin {
    display: none;
  }
}
</style>
