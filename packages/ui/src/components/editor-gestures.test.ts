import { enableAutoUnmount, mount } from "@vue/test-utils"
import { afterEach, describe, expect, it, vi } from "vitest"
import { nextTick } from "vue"
import type { UiGestureIntent } from "../types"

import UiArrangementTrackSurface from "./UiArrangementTrackSurface.vue"
import UiAutomationLane from "./UiAutomationLane.vue"
import UiPianoKeyboard from "./UiPianoKeyboard.vue"
import UiPianoRollGrid from "./UiPianoRollGrid.vue"
import UiPianoRollNote from "./UiPianoRollNote.vue"
import UiTimelineRuler from "./UiTimelineRuler.vue"
import UiVelocityLane from "./UiVelocityLane.vue"
import UiGestureSurface from "./internal/UiGestureSurface.vue"

enableAutoUnmount(afterEach)
afterEach(() => vi.restoreAllMocks())

function pointer(element: Element, type: string, init: PointerEventInit = {}) {
  element.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      clientX: 30,
      clientY: 40,
      ...init
    })
  )
}

function bounds(element: Element) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 20, 400, 100))
}

describe("editor gesture contracts", () => {
  it("selects a track once per gesture, creates at pointer or keyboard position, and reorders", async () => {
    const track = mount(UiArrangementTrackSurface, {
      props: {
        label: "Audio track",
        trackId: "track-1",
        selected: true,
        focusable: true,
        keyboardPosition: 96
      }
    })
    bounds(track.element)
    pointer(track.element, "pointerdown")
    pointer(track.element, "pointermove", { clientX: 45 })
    pointer(track.element, "pointerup", { clientX: 45 })
    expect(track.emitted("select")).toEqual([[]])
    expect(track.emitted<[UiGestureIntent]>("gesture")?.map(([intent]) => intent.phase)).toEqual([
      "start",
      "update",
      "commit"
    ])
    expect(track.attributes("tabindex")).toBe("0")
    await track.trigger("dblclick", { clientX: 50, clientY: 40 })
    await track.trigger("keydown", { key: "Enter" })
    await track.trigger("keydown", { key: "ArrowUp", altKey: true })
    await track.trigger("keydown", { key: "ArrowDown", altKey: true })
    expect(track.emitted("create")).toEqual([[40], [96]])
    expect(track.emitted("reorder")).toEqual([[-1], [1]])
  })

  it("cancels on Escape and lost capture, ignores unrelated pointers, and respects disabled descendants", async () => {
    const surface = mount(UiGestureSurface, {
      props: { label: "Gesture", as: "button" },
      slots: { default: '<input aria-label="Child" />' }
    })
    bounds(surface.element)
    pointer(surface.element, "pointerdown", { button: 2 })
    pointer(surface.element, "pointermove")
    pointer(surface.element, "pointerup")
    expect(surface.emitted("gesture")).toBeUndefined()
    pointer(surface.element, "pointerdown")
    pointer(surface.element, "pointerdown", { pointerId: 2 })
    pointer(surface.element, "pointercancel", { pointerId: 2 })
    pointer(surface.element, "pointermove", { clientX: 42, shiftKey: true })
    await surface.trigger("keydown", { key: "Escape" })
    expect(surface.emitted("gesture")?.at(-1)).toEqual([
      {
        phase: "cancel",
        point: { x: 32, y: 20 },
        delta: { x: 12, y: 0 },
        modifiers: { alt: false, control: false, meta: false, shift: false }
      }
    ])
    pointer(surface.element, "pointerup")
    pointer(surface.element, "pointerdown")
    pointer(surface.element, "lostpointercapture")
    expect(surface.emitted<[UiGestureIntent]>("gesture")?.map(([intent]) => intent.phase)).toEqual([
      "start",
      "update",
      "cancel",
      "start",
      "cancel"
    ])
    for (const key of ["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp"])
      await surface.trigger("keydown", { key })
    expect(surface.emitted("step")).toEqual([[-1], [-1], [1], [1]])
    await surface.trigger("keydown", { key: "Backspace" })
    await surface.trigger("keydown", { key: " " })
    expect(surface.emitted("remove")).toEqual([[]])
    expect(surface.emitted("activate")).toEqual([[]])
    await surface.get("input").trigger("keydown", { key: "Delete" })
    expect(surface.emitted("remove")).toHaveLength(1)
    await surface.setProps({ disabled: true })
    pointer(surface.element, "pointerdown")
    await surface.trigger("keydown", { key: "Enter" })
    await surface.trigger("dblclick")
    expect(surface.emitted("activate")).toHaveLength(1)
    expect(surface.emitted("doubleActivate")).toBeUndefined()
  })

  it.each(["pointerup", "pointercancel", "lostpointercapture", "Escape"])(
    "ends grid drawing with %s and never starts from a note",
    async (end) => {
      const grid = mount(UiPianoRollGrid, {
        props: { label: "Notes" },
        slots: { default: "<span>Note</span>" }
      })
      bounds(grid.element)
      pointer(grid.get("span").element, "pointerdown")
      pointer(grid.element, "pointerdown", { button: 2 })
      expect(grid.emitted("gesture")).toBeUndefined()
      pointer(grid.element, "pointerdown", { ctrlKey: true })
      pointer(grid.element, "pointerdown", { pointerId: 2 })
      pointer(grid.element, "pointermove", { pointerId: 2 })
      pointer(grid.element, "pointermove", { clientX: 80 })
      if (end === "Escape") await grid.trigger("keydown", { key: "Escape" })
      else pointer(grid.element, end)
      pointer(grid.element, "pointerup")
      expect(grid.emitted<[UiGestureIntent]>("gesture")?.map(([intent]) => intent.phase)).toEqual([
        "start",
        "update",
        end === "pointerup" ? "commit" : "cancel"
      ])
      expect(grid.emitted("gesture")?.[0]).toEqual([
        {
          phase: "start",
          point: { x: 20, y: 20 },
          delta: { x: 0, y: 0 },
          modifiers: { alt: false, control: true, meta: false, shift: false }
        }
      ])
    }
  )

  it.each(["move", "resize-left", "resize-right"] as const)(
    "previews and commits piano note %s in grid coordinates",
    async (mode) => {
      const grid = document.createElement("div")
      grid.className = "ui-piano-roll-grid"
      bounds(grid)
      const note = mount(UiPianoRollNote, {
        attachTo: grid,
        props: { model: { id: "n1", label: "C3", selected: true } }
      })
      const target =
        mode === "move"
          ? note.element
          : note.get(`.ui-piano-roll-note__handle--${mode === "resize-left" ? "left" : "right"}`)
              .element
      pointer(target, "pointerdown", { button: 2 })
      pointer(target, "pointerdown", { altKey: true })
      pointer(target, "pointerdown", { pointerId: 2 })
      pointer(target, "pointermove", { pointerId: 2 })
      pointer(target, "pointermove", { clientX: 50, clientY: 30 })
      pointer(target, "pointerup", { clientX: 50, clientY: 30 })
      expect(
        note
          .emitted<[string, UiGestureIntent]>("gesture")
          ?.map(([action, intent]) => [action, intent.phase])
      ).toEqual([
        [mode, "start"],
        [mode, "update"],
        [mode, "commit"]
      ])
      expect(note.emitted("gesture")?.at(-1)?.[1]).toMatchObject({
        point: { x: 40, y: 10 },
        delta: { x: 20, y: -10 }
      })
      await note.trigger("click", { shiftKey: true })
      await note.trigger("pointerover")
      expect(note.emitted("select")).toEqual([
        [{ alt: false, control: false, meta: false, shift: true }]
      ])
      expect(note.emitted("hover")).toHaveLength(1)
      expect(note.attributes("aria-pressed")).toBe("true")
      pointer(target, "pointerdown")
      pointer(target, "pointercancel")
      expect(note.emitted<[string, UiGestureIntent]>("gesture")?.at(-1)?.[1].phase).toBe("cancel")
      pointer(target, "pointerdown")
      await note.trigger("keydown", { key: "Escape" })
      pointer(target, "pointerup")
      expect(note.emitted("gesture")?.at(-1)?.[1]).toMatchObject({
        phase: "cancel",
        delta: { x: 0, y: 0 }
      })
    }
  )

  it("renders piano key labels and emits the selected MIDI key", async () => {
    const keyboard = mount(UiPianoKeyboard, {
      props: {
        label: "Keyboard",
        rowHeight: 14,
        keys: [
          { key: 0, label: "C-2", black: false },
          { key: 1, label: "C#-2", black: true }
        ]
      }
    })
    await keyboard.get('[aria-label="C#-2"]').trigger("click")
    expect(keyboard.emitted("select")).toEqual([[1]])
    expect(keyboard.get('[aria-label="C-2"]').text()).toBe("C-2")
    expect(keyboard.get('[aria-label="C#-2"]').text()).toBe("")
  })

  it("keeps velocity scroll synchronized and emits normalized edit gestures", async () => {
    const lane = mount(UiVelocityLane, {
      props: {
        label: "Velocity",
        header: "Velocity",
        width: 800,
        scrollLeft: 0,
        bars: [{ id: "n1", label: "C3 velocity 90", x: 20, height: 70, selected: true }]
      }
    })
    expect(lane.get('[role="img"]').attributes("aria-label")).toBe("C3 velocity 90")
    const scroller = lane.get(".ui-velocity-lane__scroll")
    await lane.setProps({ scrollLeft: 120 })
    expect(scroller.element.scrollLeft).toBe(120)
    scroller.element.scrollLeft = 160
    await scroller.trigger("scroll")
    expect(lane.emitted("updateScrollLeft")).toEqual([[160]])
    const canvas = lane.get('[aria-label="Velocity"]')
    pointer(canvas.element, "pointerdown")
    pointer(canvas.element, "pointerup")
    expect(lane.emitted<[UiGestureIntent]>("gesture")?.map(([intent]) => intent.phase)).toEqual([
      "start",
      "commit"
    ])
  })

  it.each(["value", "marker"] as const)(
    "renders %s automation and separates point gestures from clearing selection",
    async (mode) => {
      const lane = mount(UiAutomationLane, {
        props: {
          mode,
          label: "Automation",
          width: 400,
          height: 100,
          points: [
            {
              id: "p1",
              label: "Point 1",
              x: 30,
              y: 40,
              selected: true,
              segmentLabel: "Verse",
              segmentWidth: 80
            },
            { id: "p2", label: "Fixed point", x: 100, y: 20, removable: false }
          ],
          beatGuides: [20],
          verticalGuides: [80],
          horizontalGuides: [{ position: 40, label: "0 dB" }],
          linePath: "M0 40L400 40",
          fillPath: "M0 40L400 40L400 100Z"
        }
      })
      bounds(lane.element)
      const point = lane.get('[aria-label="Point 1"]')
      pointer(point.element, "pointerdown")
      pointer(point.element, "pointermove", { clientX: 60 })
      pointer(point.element, "pointercancel")
      expect(
        lane
          .emitted<[string, UiGestureIntent]>("pointGesture")
          ?.map(([id, intent]) => [id, intent.phase])
      ).toEqual([
        ["p1", "start"],
        ["p1", "update"],
        ["p1", "cancel"]
      ])
      expect(lane.emitted("clearSelection")).toBeUndefined()
      await lane.get('[aria-label="Fixed point"]').trigger("keydown", { key: "Delete" })
      expect(lane.emitted("remove")).toBeUndefined()
      pointer(lane.element, "pointerdown")
      pointer(lane.element, "pointerup")
      expect(lane.emitted("clearSelection")).toEqual([[]])
      await nextTick()
      expect(lane.text()).toContain(mode === "value" ? "0 dB" : "Verse")
    }
  )

  it("seeks, edits all cycle handles, and moves the project end without leaking DOM events", async () => {
    const ruler = mount(UiTimelineRuler, {
      props: {
        width: 400,
        label: "Ruler",
        marks: [{ id: "bar1", position: 0, label: "1" }],
        beatMarks: [{ id: "beat1", position: 20 }],
        cycleLabel: "Cycle",
        cycleRegion: { start: 30, end: 100 },
        cycleEnabled: true,
        projectEnd: 320,
        projectEndLabel: "Project end"
      }
    })
    bounds(ruler.element)
    pointer(ruler.element, "pointerdown", { clientX: 0 })
    pointer(ruler.element, "pointerup")
    expect(ruler.emitted("seek")).toEqual([[0]])
    for (const [selector, action] of [
      [".ui-timeline-ruler__cycle-lane", "create"],
      [".ui-timeline-ruler__cycle", "move"],
      [".ui-timeline-ruler__edge--start", "resize-start"],
      [".ui-timeline-ruler__edge--end", "resize-end"]
    ]) {
      const handle = ruler.get(selector!)
      pointer(handle.element, "pointerdown")
      pointer(handle.element, "pointerup")
      expect(ruler.emitted("cycleGesture")?.at(-1)).toEqual([
        action,
        expect.objectContaining({ phase: "commit", point: { x: 20, y: 20 } })
      ])
    }
    const end = ruler.get('[aria-label="Project end"]')
    pointer(end.element, "pointerdown")
    pointer(end.element, "pointerup")
    await end.trigger("keydown", { key: "ArrowLeft" })
    await end.trigger("keydown", { key: "ArrowRight" })
    expect(
      ruler.emitted<[UiGestureIntent]>("projectEndGesture")?.map(([intent]) => intent.phase)
    ).toEqual(["start", "commit"])
    expect(ruler.emitted("projectEndStep")).toEqual([[-1], [1]])
    expect(ruler.emitted("seek")).toHaveLength(1)
  })
})
