import type { Meta, StoryObj } from "@storybook/vue3-vite"
import { expect, fireEvent, userEvent, within } from "storybook/test"
import UiPianoKeyboard from "./UiPianoKeyboard.vue"
import UiPianoRollGrid from "./UiPianoRollGrid.vue"
import UiPianoRollNote from "./UiPianoRollNote.vue"
import UiVelocityLane from "./UiVelocityLane.vue"
import UiPianoRollViewport from "./UiPianoRollViewport.vue"

const meta = {
  title: "Components/Piano roll",
  component: UiPianoRollNote,
  tags: ["autodocs"],
  args: { model: { id: "note", label: "C4", selected: true } }
} satisfies Meta<typeof UiPianoRollNote>
export default meta
type Story = StoryObj<typeof meta>

export const KeyboardAndNotes: Story = {
  render: () => ({
    components: { UiPianoKeyboard, UiPianoRollGrid, UiPianoRollNote },
    data: () => ({
      status: "idle",
      keys: Array.from({ length: 12 }, (_, key) => ({
        key,
        label: ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][key] + "4",
        black: [1, 3, 6, 8, 10].includes(key)
      }))
    }),
    methods: {
      noteGesture(_mode: string, intent: { phase: string }) {
        this.status = intent.phase
      }
    },
    template: `
      <div style="position:relative;height:14rem">
        <UiPianoKeyboard :keys="keys" :row-height="18" label="Piano keyboard" @select="status='key '+$event" />
        <UiPianoRollGrid label="Note grid" style="left:72px;width:28rem;height:14rem" @gesture="status=$event.phase">
          <UiPianoRollNote :model="{id:'note',label:'C4',selected:true}" style="left:4rem;top:5rem;width:8rem;height:18px" @gesture="noteGesture" />
        </UiPianoRollGrid>
        <output>{{status}}</output>
      </div>
    `
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getAllByRole("button", { name: "C4" })[0]!)
    await expect(canvas.getByText("key 0")).toBeVisible()
    const note = canvas.getByRole("button", { name: "C4", pressed: true })
    await fireEvent.pointerDown(note, { pointerId: 1, clientX: 100, clientY: 100 })
    await fireEvent.pointerUp(note, { pointerId: 1, clientX: 120, clientY: 100 })
  }
}

export const VelocityEditing = {
  render: () => ({
    components: { UiVelocityLane },
    data: () => ({
      scrollLeft: 0,
      status: "idle",
      bars: [
        {
          id: "c4",
          x: 40,
          height: 72,
          color: "var(--ui-signal-midi)",
          label: "C4 velocity 92",
          selected: true
        },
        { id: "e4", x: 140, height: 48, color: "var(--ui-signal-midi)", label: "E4 velocity 61" }
      ]
    }),
    template: `<UiVelocityLane :width="480" label="Velocity lane" header="Velocity" :bars="bars" :scroll-left="scrollLeft" @update-scroll-left="scrollLeft=$event" @gesture="status=$event.phase" /><output>{{status}}</output>`
  }),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)
    const lane = canvas.getByLabelText("Velocity lane")
    await fireEvent.pointerDown(lane, { pointerId: 1, clientX: 80, clientY: 60 })
    await fireEvent.pointerUp(lane, { pointerId: 1, clientX: 80, clientY: 60 })
    await expect(canvas.getByText("commit")).toBeVisible()
  }
}

export const PianoViewport = {
  render: () => ({
    components: { UiPianoRollViewport },
    data: () => ({ status: "idle" }),
    template: `<UiPianoRollViewport label="Piano roll viewport" style="width:30rem;height:10rem" @focus-change="status=$event?'focused':'blurred'" @keyboard="status=$event.key"><div style="width:50rem;height:20rem">Notes</div></UiPianoRollViewport><output>{{status}}</output>`
  }),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)
    const viewport = canvas.getByLabelText("Piano roll viewport")
    viewport.focus()
    await userEvent.keyboard("a")
    await expect(canvas.getByText("a")).toBeVisible()
  }
}
