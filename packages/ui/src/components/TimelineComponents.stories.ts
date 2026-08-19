import type { Meta, StoryObj } from "@storybook/vue3-vite"
import { expect, fireEvent, userEvent, within } from "storybook/test"
import { shallowRef } from "vue"
import UiTimelineClip from "./UiTimelineClip.vue"
import UiTimelineRuler from "./UiTimelineRuler.vue"
import UiAutomationLane from "./UiAutomationLane.vue"
import UiArrangementTrackSurface from "./UiArrangementTrackSurface.vue"
import UiArrangementViewport from "./UiArrangementViewport.vue"

const meta = {
  title: "Components/Timeline",
  component: UiTimelineClip,
  tags: ["autodocs"]
} satisfies Meta<typeof UiTimelineClip>
export default meta
type Story = StoryObj<typeof meta>
export const ClipEditing: Story = {
  args: {
    model: {
      id: "verse",
      label: "Verse",
      start: 20,
      width: 240,
      selected: true,
      signalColor: "var(--ui-signal-audio)"
    },
    kind: "audio",
    label: "Audio clip Verse",
    openLabel: "Open Verse",
    trimStartLabel: "Trim Verse start",
    trimEndLabel: "Trim Verse end",
    fadeInLabel: "Adjust Verse fade in",
    fadeOutLabel: "Adjust Verse fade out",
    fadeInPercent: 18,
    fadeOutPercent: 12
  },
  render: (args) => ({
    components: { UiTimelineClip },
    setup: () => ({ args }),
    data: () => ({ status: "idle" }),
    methods: {
      gesture(kind: string, intent: { phase: string }) {
        this.status = `${kind}:${intent.phase}`
      }
    },
    template: `<div style="position:relative;height:7rem"><UiTimelineClip v-bind="args" @gesture="gesture" @remove="status='removed'" /><output>{{status}}</output></div>`
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const clip = canvas.getByRole("button", { name: "Audio clip Verse" })
    clip.focus()
    await userEvent.keyboard("{Delete}")
    await expect(canvas.getByText("removed")).toBeVisible()
    const handle = canvas.getByRole("separator", { name: "Trim Verse end" })
    await fireEvent.pointerDown(handle, { pointerId: 1, clientX: 240 })
    await fireEvent.pointerMove(handle, { pointerId: 1, clientX: 260 })
    await fireEvent.pointerUp(handle, { pointerId: 1, clientX: 260 })
  }
}

export const RulerInteractions = {
  render: () => ({
    components: { UiTimelineRuler },
    setup() {
      const status = shallowRef("idle")
      const end = shallowRef(520)
      const cycle = (_mode: string, intent: { phase: string }) => {
        status.value = `cycle:${intent.phase}`
      }
      return { status, end, cycle }
    },
    template: `<div style="overflow:auto"><UiTimelineRuler :width="900" label="Timeline ruler" :marks="[{id:'1',label:'01',position:0},{id:'2',label:'02',position:240},{id:'3',label:'03',position:480}]" :beat-marks="[{id:'b1',position:120},{id:'b2',position:360}]" cycle-label="Cycle range" :cycle-region="{start:120,end:420}" cycle-enabled :project-end="end" project-end-label="Project end" @seek="status='seek:'+Math.round($event)" @cycle-gesture="cycle" @project-end-step="end += $event * 24" /><output>{{status}}</output></div>`
  }),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)
    const end = canvas.getByRole("button", { name: "Project end" })
    end.focus()
    await userEvent.keyboard("{ArrowRight}")
    await expect(end).toHaveFocus()
  }
}

export const AutomationEditing = {
  render: () => ({
    components: { UiAutomationLane },
    data: () => ({ status: "idle" }),
    template: `<div><UiAutomationLane mode="value" label="Volume automation" :width="720" :height="120" color="var(--ui-signal-automation)" :vertical-guides="[120,240,360,480,600]" :horizontal-guides="[{position:30,label:'6'},{position:60,label:'0'},{position:90,label:'-12'}]" line-path="M 0 80 H 160 V 35 H 420 V 68 H 720" fill-path="M 0 80 H 160 V 35 H 420 V 68 H 720 V 120 H 0 Z" :points="[{id:'a',x:160,y:35,label:'Volume 3 dB',selected:true},{id:'b',x:420,y:68,label:'Volume -3 dB'}]" @point-gesture="status='gesture'" @create="status='create'" /><output>{{status}}</output></div>`
  }),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)
    const point = canvas.getByRole("button", { name: "Volume 3 dB" })
    await fireEvent.pointerDown(point, { pointerId: 1, clientX: 160, clientY: 35 })
    await fireEvent.pointerUp(point, { pointerId: 1, clientX: 180, clientY: 45 })
    await expect(point).toBeVisible()
  }
}

export const ArrangementSurfaces = {
  render: () => ({
    components: { UiArrangementTrackSurface, UiArrangementViewport },
    data: () => ({ status: "idle" }),
    template: `<UiArrangementViewport label="Arrangement viewport" style="width:36rem;height:10rem" @viewport="status='scroll'"><div style="width:60rem"><UiArrangementTrackSurface label="Audio track Vocal" track-id="vocal" track-kind="audio" :selected="true" style="height:5rem" @select="status='selected'">Vocal clips</UiArrangementTrackSurface></div></UiArrangementViewport><output>{{status}}</output>`
  }),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.pointerDown(canvas.getByLabelText("Audio track Vocal"))
    await expect(canvas.getByText("selected")).toBeVisible()
  }
}
