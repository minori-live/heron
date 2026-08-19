import { computed, shallowRef, type ComputedRef, type CSSProperties } from "vue"
import type { MidiClipState, MidiNotePatch, MidiNoteState, ProjectCommand } from "@heron/contracts"
import type { UiGestureIntent, UiModifiers, UiPoint } from "@heron/ui"
import type { PianoRollNoteRef, usePianoRollStore } from "../../stores/pianoRoll"
import {
  MIN_NOTE_TICKS,
  noteGlobalStart,
  planCreatedNotes,
  planExistingNoteEdits,
  snapStep,
  snapTicks,
  type PlannedClipEdit
} from "../../utils/pianoRoll"

export interface NoteGestureItem {
  clip: MidiClipState
  note: MidiNoteState
  globalStartTick: number
}

export interface PianoRollNoteEdit extends NoteGestureItem {
  durationTicks: number
  patch?: Omit<MidiNotePatch, "startTick" | "durationTicks">
}

const DRAG_THRESHOLD_PX = 3

interface NoteGesture {
  kind: "note"
  mode: "move" | "resize-left" | "resize-right"
  startX: number
  startY: number
  currentX: number
  currentY: number
  items: NoteGestureItem[]
}

interface MarqueeGesture {
  kind: "marquee"
  anchorX: number
  anchorY: number
  currentX: number
  currentY: number
  additive: boolean
  baseSelection: PianoRollNoteRef[]
  moved: boolean
}

interface CreateGesture {
  kind: "create"
  clip: MidiClipState
  anchorTick: number
  currentTick: number
  currentKey: number
  moved: boolean
}

interface EraseGesture {
  kind: "erase"
  targets: Map<string, PianoRollNoteRef>
}

type Gesture = NoteGesture | MarqueeGesture | CreateGesture | EraseGesture

export interface PianoRollGestureDependencies {
  pianoRollStore: ReturnType<typeof usePianoRollStore>
  pixelsPerTick: ComputedRef<number>
  visibleNotes: ComputedRef<NoteGestureItem[]>
  selectedItems: ComputedRef<NoteGestureItem[]>
  activeClip: ComputedRef<MidiClipState | null>
  trackColor: (clip: MidiClipState) => string
  batch: (commands: ProjectCommand[]) => Promise<boolean>
  commandsForEdits: (values: PianoRollNoteEdit[]) => ProjectCommand[]
}

export interface PianoRollGestures {
  gestureNotePreviews: ComputedRef<
    Map<string, { globalStartTick: number; durationTicks: number; key: number }>
  >
  gestureClipRanges: ComputedRef<Map<string, PlannedClipEdit>>
  marqueeStyle: ComputedRef<CSSProperties | null>
  createPreviewStyle: ComputedRef<CSSProperties | null>
  eraseTargetKeys: ComputedRef<Set<string>>
  beginNoteGesture: (
    intent: UiGestureIntent,
    clip: MidiClipState,
    note: MidiNoteState,
    mode: NoteGesture["mode"]
  ) => void
  updateNoteGesture: (intent: UiGestureIntent) => void
  finishNoteGesture: (intent: UiGestureIntent) => void
  cancelNoteGesture: () => void
  handleNoteClick: (modifiers: UiModifiers, clip: MidiClipState, note: MidiNoteState) => void
  handleNotePointerOver: (clip: MidiClipState, note: MidiNoteState) => void
  handleGridPointerDown: (intent: UiGestureIntent) => void
  handleGridPointerMove: (intent: UiGestureIntent) => void
  handleGridPointerUp: (intent: UiGestureIntent) => void
  cancelGridGesture: () => void
  handleNoteGesture: (
    mode: NoteGesture["mode"],
    intent: UiGestureIntent,
    clip: MidiClipState,
    note: MidiNoteState
  ) => void
  handleGridGesture: (intent: UiGestureIntent) => void
}

export function createPianoRollGestures(
  dependencies: PianoRollGestureDependencies
): PianoRollGestures {
  const {
    pianoRollStore,
    pixelsPerTick,
    visibleNotes,
    selectedItems,
    activeClip,
    trackColor,
    batch,
    commandsForEdits
  } = dependencies
  const gesture = shallowRef<Gesture | null>(null)
  let suppressedNoteClickKey: string | null = null

  function editsForGesture(
    current: NoteGesture,
    clientX: number,
    clientY: number
  ): PianoRollNoteEdit[] {
    const rawTickDelta = (clientX - current.startX) / pixelsPerTick.value
    const step = snapStep(pianoRollStore.snap)
    const tickDelta = Math.round(rawTickDelta / step) * step
    const rawKeyDelta = -Math.round((clientY - current.startY) / pianoRollStore.rowHeight)
    const minimumStart = Math.min(...current.items.map((item) => item.globalStartTick))
    const minimumKey = Math.min(...current.items.map((item) => item.note.key))
    const maximumKey = Math.max(...current.items.map((item) => item.note.key))
    const moveTickDelta = Math.max(-minimumStart, tickDelta)
    const keyDelta = Math.max(-minimumKey, Math.min(127 - maximumKey, rawKeyDelta))

    return current.items.map((item) => {
      if (current.mode === "resize-right") {
        return {
          ...item,
          durationTicks: Math.max(MIN_NOTE_TICKS, item.note.durationTicks + tickDelta)
        }
      }
      if (current.mode === "resize-left") {
        const requested = Math.min(item.note.durationTicks - MIN_NOTE_TICKS, tickDelta)
        const globalStartTick = Math.max(0, item.globalStartTick + requested)
        const applied = globalStartTick - item.globalStartTick
        return {
          ...item,
          globalStartTick,
          durationTicks: item.note.durationTicks - applied
        }
      }
      return {
        ...item,
        globalStartTick: item.globalStartTick + moveTickDelta,
        durationTicks: item.note.durationTicks,
        patch: { key: item.note.key + keyDelta }
      }
    })
  }

  const gestureEdits = computed(() => {
    const current = gesture.value
    return current?.kind === "note"
      ? editsForGesture(current, current.currentX, current.currentY)
      : []
  })
  const gestureNotePreviews = computed(
    () =>
      new Map(
        gestureEdits.value.map((edit) => [
          `${edit.clip.id}:${edit.note.id}`,
          {
            globalStartTick: edit.globalStartTick,
            durationTicks: edit.durationTicks,
            key: edit.patch?.key ?? edit.note.key
          }
        ])
      )
  )
  const gestureClipRanges = computed(() => {
    const byClip = new Map<string, PianoRollNoteEdit[]>()
    for (const edit of gestureEdits.value) {
      const values = byClip.get(edit.clip.id) ?? []
      values.push(edit)
      byClip.set(edit.clip.id, values)
    }
    return new Map(
      [...byClip].map(([clipId, edits]) => {
        const clip = edits[0]!.clip
        const plan = planExistingNoteEdits(
          clip,
          edits.map((edit) => ({
            noteId: edit.note.id,
            globalStartTick: edit.globalStartTick,
            durationTicks: edit.durationTicks,
            patch: edit.patch
          }))
        )
        return [clipId, plan]
      })
    )
  })

  const marqueeStyle = computed<CSSProperties | null>(() => {
    const current = gesture.value
    if (current?.kind !== "marquee" || !current.moved) return null
    return {
      left: `${Math.min(current.anchorX, current.currentX)}px`,
      top: `${Math.min(current.anchorY, current.currentY)}px`,
      width: `${Math.abs(current.currentX - current.anchorX)}px`,
      height: `${Math.abs(current.currentY - current.anchorY)}px`
    }
  })

  const createdNoteValues = computed(() => {
    const current = gesture.value
    return current?.kind === "create" ? createdNoteValuesFor(current) : null
  })
  const createPreviewStyle = computed<CSSProperties | null>(() => {
    const values = createdNoteValues.value
    if (!values) return null
    return {
      left: `${values.globalStartTick * pixelsPerTick.value}px`,
      top: `${(127 - values.key) * pianoRollStore.rowHeight + 1}px`,
      width: `${Math.max(2, values.durationTicks * pixelsPerTick.value)}px`,
      height: `${Math.max(4, pianoRollStore.rowHeight - 2)}px`,
      "--note-color": trackColor(values.clip)
    }
  })

  const eraseTargetKeys = computed(() => {
    const current = gesture.value
    return current?.kind === "erase" ? new Set(current.targets.keys()) : new Set<string>()
  })

  function suppressNextNoteClick(key: string): void {
    suppressedNoteClickKey = key
    window.setTimeout(() => {
      if (suppressedNoteClickKey === key) suppressedNoteClickKey = null
    }, 0)
  }

  function eraseNote(clip: MidiClipState, note: MidiNoteState): void {
    const current = gesture.value
    if (current?.kind !== "erase") return
    const key = `${clip.id}:${note.id}`
    if (current.targets.has(key)) return
    const targets = new Map(current.targets)
    targets.set(key, { clipId: clip.id, noteId: note.id })
    gesture.value = { ...current, targets }
  }

  function finishEraseGesture(): void {
    const current = gesture.value
    if (current?.kind !== "erase") return
    gesture.value = null
    if (current.targets.size === 0) return
    const byClip = new Map<string, string[]>()
    for (const target of current.targets.values()) {
      const ids = byClip.get(target.clipId) ?? []
      ids.push(target.noteId)
      byClip.set(target.clipId, ids)
    }
    const commands: ProjectCommand[] = [...byClip].map(([clipId, noteIds]) => ({
      type: "delete-midi-notes",
      clipId,
      noteIds
    }))
    void batch(commands)
  }

  function beginNoteGesture(
    intent: UiGestureIntent,
    clip: MidiClipState,
    note: MidiNoteState,
    mode: NoteGesture["mode"]
  ): void {
    const key = `${clip.id}:${note.id}`
    if (pianoRollStore.tool === "erase" || intent.modifiers.alt) {
      suppressNextNoteClick(key)
      if (pianoRollStore.tool === "erase") {
        gesture.value = {
          kind: "erase",
          targets: new Map([[key, { clipId: clip.id, noteId: note.id }]])
        }
      } else {
        void batch([{ type: "delete-midi-notes", clipId: clip.id, noteIds: [note.id] }])
      }
      return
    }
    const reference = { clipId: clip.id, noteId: note.id }
    suppressedNoteClickKey = key
    if (!pianoRollStore.selectedNoteKeys.has(key)) {
      pianoRollStore.selectNote(reference, intent.modifiers.control || intent.modifiers.meta)
    }
    gesture.value = {
      kind: "note",
      startX: intent.point.x,
      startY: intent.point.y,
      currentX: intent.point.x,
      currentY: intent.point.y,
      mode,
      items: selectedItems.value.map((item) => ({ ...item }))
    }
  }

  function updateNoteGesture(intent: UiGestureIntent): void {
    const current = gesture.value
    if (current?.kind !== "note") return
    gesture.value = { ...current, currentX: intent.point.x, currentY: intent.point.y }
  }

  function finishNoteGesture(intent: UiGestureIntent): void {
    const current = gesture.value
    if (current?.kind !== "note") return
    gesture.value = null
    const edits = editsForGesture(current, intent.point.x, intent.point.y).filter(
      (item) =>
        item.globalStartTick !== noteGlobalStart(item.clip, item.note) ||
        item.durationTicks !== item.note.durationTicks ||
        (item.patch?.key ?? item.note.key) !== item.note.key
    )
    if (edits.length > 0) void batch(commandsForEdits(edits))
    const key = suppressedNoteClickKey
    window.setTimeout(() => {
      if (suppressedNoteClickKey === key) suppressedNoteClickKey = null
    }, 0)
  }

  function cancelNoteGesture(): void {
    if (gesture.value?.kind !== "note") return
    gesture.value = null
    suppressedNoteClickKey = null
  }

  function handleNoteClick(modifiers: UiModifiers, clip: MidiClipState, note: MidiNoteState): void {
    const key = `${clip.id}:${note.id}`
    if (suppressedNoteClickKey === key) {
      suppressedNoteClickKey = null
      return
    }
    if (pianoRollStore.tool === "erase" || modifiers.alt) return
    const additive = modifiers.control || modifiers.meta
    if (!pianoRollStore.selectedNoteKeys.has(key) || additive) {
      pianoRollStore.selectNote({ clipId: clip.id, noteId: note.id }, additive)
    }
  }

  function handleNotePointerOver(clip: MidiClipState, note: MidiNoteState): void {
    eraseNote(clip, note)
  }

  function gridPoint(position: UiPoint): { tick: number; key: number } {
    const tick = snapTicks(position.x / pixelsPerTick.value, pianoRollStore.snap)
    const key = Math.max(0, Math.min(127, 127 - Math.floor(position.y / pianoRollStore.rowHeight)))
    return { tick, key }
  }

  function marqueeSelection(current: MarqueeGesture): PianoRollNoteRef[] {
    const minX = Math.min(current.anchorX, current.currentX)
    const maxX = Math.max(current.anchorX, current.currentX)
    const minY = Math.min(current.anchorY, current.currentY)
    const maxY = Math.max(current.anchorY, current.currentY)
    const minTick = minX / pixelsPerTick.value
    const maxTick = maxX / pixelsPerTick.value
    const highestKey = 127 - Math.floor(minY / pianoRollStore.rowHeight)
    const lowestKey = 127 - Math.floor(maxY / pianoRollStore.rowHeight)
    const contained = visibleNotes.value
      .filter(
        ({ note, globalStartTick }) =>
          note.key >= lowestKey &&
          note.key <= highestKey &&
          globalStartTick < maxTick &&
          globalStartTick + note.durationTicks > minTick
      )
      .map(({ clip, note }) => ({ clipId: clip.id, noteId: note.id }))
    return current.additive ? [...current.baseSelection, ...contained] : contained
  }

  function handleGridPointerDown(intent: UiGestureIntent): void {
    const point = gridPoint(intent.point)
    pianoRollStore.editCursorTick = point.tick
    pianoRollStore.editCursorKey = point.key
    if (pianoRollStore.tool === "erase") {
      gesture.value = { kind: "erase", targets: new Map() }
      return
    }
    if (pianoRollStore.tool === "draw") {
      if (!activeClip.value) return
      gesture.value = {
        kind: "create",
        clip: activeClip.value,
        anchorTick: point.tick,
        currentTick: point.tick,
        currentKey: point.key,
        moved: false
      }
      return
    }
    const position = intent.point
    gesture.value = {
      kind: "marquee",
      anchorX: position.x,
      anchorY: position.y,
      currentX: position.x,
      currentY: position.y,
      additive: intent.modifiers.control || intent.modifiers.meta || intent.modifiers.shift,
      baseSelection: [...pianoRollStore.selectedNotes],
      moved: false
    }
  }

  function handleGridPointerMove(intent: UiGestureIntent): void {
    const current = gesture.value
    if (current?.kind === "marquee") {
      const position = intent.point
      const moved =
        current.moved ||
        Math.max(Math.abs(position.x - current.anchorX), Math.abs(position.y - current.anchorY)) >=
          DRAG_THRESHOLD_PX
      const next: MarqueeGesture = { ...current, currentX: position.x, currentY: position.y, moved }
      gesture.value = next
      if (moved) pianoRollStore.setSelectedNotes(marqueeSelection(next))
      return
    }
    if (current?.kind === "create") {
      const point = gridPoint(intent.point)
      const moved =
        current.moved || point.tick !== current.anchorTick || point.key !== current.currentKey
      gesture.value = { ...current, currentTick: point.tick, currentKey: point.key, moved }
    }
  }

  function handleGridPointerUp(intent: UiGestureIntent): void {
    const current = gesture.value
    if (current?.kind === "erase") {
      finishEraseGesture()
      return
    }
    if (current?.kind === "marquee") {
      gesture.value = null
      const position = intent.point
      const moved =
        current.moved ||
        Math.max(Math.abs(position.x - current.anchorX), Math.abs(position.y - current.anchorY)) >=
          DRAG_THRESHOLD_PX
      if (!moved) pianoRollStore.clearNoteSelection()
      return
    }
    if (current?.kind === "create") {
      gesture.value = null
      const values = createdNoteValuesFor(current)
      const noteId = crypto.randomUUID()
      const plan = planCreatedNotes(values.clip, [
        {
          id: noteId,
          globalStartTick: values.globalStartTick,
          durationTicks: values.durationTicks,
          channel: 0,
          key: values.key,
          velocity: 100,
          releaseVelocity: 0
        }
      ])
      void batch(plan.commands).then((created) => {
        if (created) pianoRollStore.selectNote({ clipId: values.clip.id, noteId })
      })
    }
  }

  function createdNoteValuesFor(current: CreateGesture): {
    clip: MidiClipState
    globalStartTick: number
    durationTicks: number
    key: number
  } {
    const step = snapStep(pianoRollStore.snap)
    const defaultDuration = pianoRollStore.snap === "off" ? 240 : step
    const minimumDuration = pianoRollStore.snap === "off" ? MIN_NOTE_TICKS : step
    const durationTicks = current.moved
      ? Math.max(minimumDuration, current.currentTick - current.anchorTick)
      : defaultDuration
    return {
      clip: current.clip,
      globalStartTick: current.anchorTick,
      durationTicks,
      key: current.currentKey
    }
  }

  function cancelGridGesture(): void {
    const kind = gesture.value?.kind
    if (kind === "marquee" || kind === "create" || kind === "erase") gesture.value = null
  }

  function handleNoteGesture(
    mode: NoteGesture["mode"],
    intent: UiGestureIntent,
    clip: MidiClipState,
    note: MidiNoteState
  ): void {
    if (intent.phase === "start") beginNoteGesture(intent, clip, note, mode)
    else if (intent.phase === "update") updateNoteGesture(intent)
    else if (intent.phase === "commit") {
      if (gesture.value?.kind === "erase") finishEraseGesture()
      else finishNoteGesture(intent)
    } else if (gesture.value?.kind === "erase") {
      gesture.value = null
    } else cancelNoteGesture()
  }

  function handleGridGesture(intent: UiGestureIntent): void {
    if (intent.phase === "start") handleGridPointerDown(intent)
    else if (intent.phase === "update") handleGridPointerMove(intent)
    else if (intent.phase === "commit") handleGridPointerUp(intent)
    else cancelGridGesture()
  }

  return {
    gestureNotePreviews,
    gestureClipRanges,
    marqueeStyle,
    createPreviewStyle,
    eraseTargetKeys,
    beginNoteGesture,
    updateNoteGesture,
    finishNoteGesture,
    cancelNoteGesture,
    handleNoteClick,
    handleNotePointerOver,
    handleNoteGesture,
    handleGridGesture,
    handleGridPointerDown,
    handleGridPointerMove,
    handleGridPointerUp,
    cancelGridGesture
  }
}
