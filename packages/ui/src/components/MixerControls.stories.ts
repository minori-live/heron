import type { Meta, StoryObj } from "@storybook/vue3-vite"
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test"

import UiLevelMeter from "./UiLevelMeter.vue"
import UiButton from "./UiButton.vue"
import UiIconButton from "./UiIconButton.vue"
import UiMixerInsert from "./UiMixerInsert.vue"
import UiInlineTextEdit from "./UiInlineTextEdit.vue"
import UiCurveEditor from "./UiCurveEditor.vue"
import UiDbScale from "./UiDbScale.vue"
import UiHorizontalFader from "./UiHorizontalFader.vue"
import UiMixerStateButton from "./UiMixerStateButton.vue"
import UiMixerSlot from "./UiMixerSlot.vue"
import UiRotaryControl from "./UiRotaryControl.vue"
import UiVerticalFader from "./UiVerticalFader.vue"

const meta = {
  title: "Components/Workspace/Mixer controls",
  component: UiRotaryControl,
  tags: ["autodocs"],
  args: {
    value: 0,
    min: -64,
    max: 63,
    step: 1,
    defaultValue: 0,
    label: "Pan",
    bipolarCenter: 0,
    accent: "var(--ui-signal-meter-safe)"
  }
} satisfies Meta<typeof UiRotaryControl>

export default meta
type Story = StoryObj<typeof meta>

export const Pan: Story = {
  render: () => ({
    components: { UiRotaryControl },
    data: () => ({ pan: 0 }),
    methods: {
      panText(value: number) {
        if (value === 0) return "Center"
        return value < 0 ? `${Math.abs(value)} left` : `${value} right`
      }
    },
    template: `
      <UiRotaryControl
        :value="pan"
        :min="-64"
        :max="63"
        :step="1"
        :default-value="0"
        :bipolar-center="0"
        label="Pan"
        value-label="Pan value"
        :value-text="panText"
        accent="var(--ui-signal-meter-safe)"
        @preview="pan = $event"
        @commit="pan = $event"
      />
    `
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const pan = canvas.getByRole("slider", { name: "Pan" })
    await fireEvent.input(pan, { target: { value: "1" } })
    await fireEvent.change(pan, { target: { value: "1" } })
    await expect(pan).toHaveAttribute("aria-valuetext", "1 right")
    await userEvent.dblClick(pan)
    await expect(pan).toHaveAttribute("aria-valuetext", "Center")
  }
}

export const LogicSendPositions: Story = {
  render: () => ({
    components: { UiRotaryControl },
    data: () => ({ pre: -18, post: -12, postPan: -9 }),
    methods: {
      db(value: number) {
        return value <= -90 ? "−∞" : `${value.toFixed(1)} dB`
      }
    },
    template: `
      <div style="display:grid;gap:12px;max-width:320px;padding:16px;background:var(--ui-color-canvas)">
        <div style="display:grid;grid-template-columns:24px 1fr;align-items:center;min-height:24px;background:var(--ui-color-surface)">
          <UiRotaryControl size="compact" ring-weight="emphasized" :drag-range-pixels="180" :value="pre" :min="-90" :max="12" :step="0.1" :default-value="-90" label="Pre-fader send level" :value-text="db" accent="var(--ui-color-action)" @preview="pre = $event" @commit="pre = $event" />
          <span style="padding-inline:8px">Vocal reverb</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 24px;align-items:center;min-height:24px;background:var(--ui-color-surface)">
          <span style="padding-inline:8px">Vocal reverb</span>
          <UiRotaryControl size="compact" ring-weight="emphasized" :drag-range-pixels="180" :value="post" :min="-90" :max="12" :step="0.1" :default-value="-90" label="Post-fader send level" :value-text="db" accent="var(--ui-color-action)" @preview="post = $event" @commit="post = $event" />
        </div>
        <div style="display:grid;grid-template-columns:1fr 24px;align-items:center;min-height:24px;background:var(--ui-color-surface)">
          <span style="padding-inline:8px">Vocal reverb</span>
          <UiRotaryControl size="compact" ring-weight="emphasized" :drag-range-pixels="180" :value="postPan" :min="-90" :max="12" :step="0.1" :default-value="-90" label="Post-pan send level" :value-text="db" accent="var(--ui-signal-meter-safe)" @preview="postPan = $event" @commit="postPan = $event" />
        </div>
      </div>
    `
  })
}

export const HorizontalFader: Story = {
  render: () => ({
    components: { UiHorizontalFader },
    data: () => ({ gain: -6 }),
    methods: {
      db(value: number) {
        return value <= -90 ? "−∞ dB" : `${value.toFixed(1)} dB`
      }
    },
    template: `
      <div style="width:148px;padding:16px;background:var(--ui-color-surface)">
        <UiHorizontalFader
          :value="gain"
          :min="-90"
          :max="12"
          :step="0.1"
          :default-value="0"
          :meter-level-percent="68"
          label="Vocal quick volume"
          :value-text="db"
          @preview="gain = $event"
          @commit="gain = $event"
        />
      </div>
    `
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const fader = canvas.getByRole("slider", { name: "Vocal quick volume" })
    const rail = canvasElement.querySelector<HTMLElement>(".ui-horizontal-fader__rail")!
    const meter = canvasElement.querySelector<HTMLElement>(".ui-horizontal-fader__meter")!
    const faderBounds = fader.getBoundingClientRect()
    await expect(faderBounds.width).toBeGreaterThan(faderBounds.height * 4)
    await expect(rail.getBoundingClientRect().height).toBeGreaterThanOrEqual(11)
    await expect(meter.getBoundingClientRect().left).toBeGreaterThan(
      rail.getBoundingClientRect().left + rail.getBoundingClientRect().width * 0.6
    )
    await expect(getComputedStyle(fader).opacity).toBe("1")
    await fireEvent.input(fader, { target: { value: "-12" } })
    await fireEvent.change(fader, { target: { value: "-12" } })
    await expect(fader).toHaveAttribute("aria-valuetext", "-12.0 dB")
    await userEvent.dblClick(fader)
    await expect(fader).toHaveAttribute("aria-valuetext", "0.0 dB")
  }
}

export const ChannelFaderAndMeter: Story = {
  render: () => ({
    components: { UiLevelMeter, UiVerticalFader },
    data: () => ({
      gain: 0,
      marks: [
        { value: 12, label: "+12", position: 0 },
        { value: 0, label: "0", position: 11.76, emphasis: true },
        { value: -12, label: "−12", position: 23.53 },
        { value: -30, label: "−30", position: 41.18 },
        { value: -60, label: "−60", position: 70.59 },
        { value: -90, label: "−∞", position: 100 }
      ],
      meterMarks: [
        { value: 0, label: "0", position: 0, emphasis: true },
        { value: -12, label: "−12", position: 20 },
        { value: -24, label: "−24", position: 40 },
        { value: -48, label: "−48", position: 80 },
        { value: -60, label: "−∞", position: 100 }
      ]
    }),
    methods: {
      db(value: number) {
        return value <= -90 ? "−∞" : `${value.toFixed(1)} dB`
      }
    },
    template: `
      <div style="display:grid;grid-template-columns:72px 34px;gap:8px;height:240px;padding:24px;background:var(--ui-color-surface)">
        <UiVerticalFader
          :value="gain"
          :min="-90"
          :max="12"
          :step="0.1"
          :default-value="0"
          :marks="marks"
          label="Vocal volume"
          :value-text="db"
          @preview="gain = $event"
          @commit="gain = $event"
        />
        <UiLevelMeter
          :channels="[
            { levelPercent: 72, heldLevelPercent: 84, hasHeldPeak: true },
            { levelPercent: 58, heldLevelPercent: 76, hasHeldPeak: true }
          ]"
          :clipped="false"
          :marks="meterMarks"
          label="Vocal post-fader level"
        />
      </div>
    `
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const fader = canvas.getByRole("slider", { name: "Vocal volume" })
    await fireEvent.input(fader, { target: { value: "-0.1" } })
    await fireEvent.change(fader, { target: { value: "-0.1" } })
    await expect(fader).toHaveAttribute("aria-valuetext", "-0.1 dB")
    await userEvent.dblClick(fader)
    await expect(fader).toHaveAttribute("aria-valuetext", "0.0 dB")
    await expect(canvas.getByRole("meter", { name: "Vocal post-fader level" })).toHaveAttribute(
      "aria-valuenow",
      "72"
    )
  }
}

export const ChannelStateButtons: Story = {
  render: () => ({
    components: { UiMixerStateButton },
    data: () => ({ mute: false, solo: true, record: false, monitor: true }),
    template: `
      <div style="display:grid;gap:16px;padding:24px;background:var(--ui-color-surface)">
        <div style="display:flex;gap:5px">
          <UiMixerStateButton tone="mute" label="Mute Vocal" :pressed="mute" @click="mute = !mute">M</UiMixerStateButton>
          <UiMixerStateButton tone="solo" label="Solo Vocal" :pressed="solo" @click="solo = !solo">S</UiMixerStateButton>
        </div>
        <div style="display:flex">
          <UiMixerStateButton size="narrow" tone="record" joined="start" label="Arm Vocal" :pressed="record" @click="record = !record">R</UiMixerStateButton>
          <UiMixerStateButton size="narrow" tone="input" joined="end" label="Monitor Vocal" :pressed="monitor" @click="monitor = !monitor">I</UiMixerStateButton>
        </div>
      </div>
    `
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const mute = canvas.getByRole("button", { name: "Mute Vocal" })
    await expect(mute).toHaveAttribute("aria-pressed", "false")
    await userEvent.click(mute)
    await expect(mute).toHaveAttribute("aria-pressed", "true")
  }
}

export const MixerSlot = {
  render: () => ({
    components: { UiMixerSlot },
    data: () => ({ selected: false }),
    template: `<UiMixerSlot label="Vocal channel" :selected="selected" style="width:8rem;padding:1rem;background:var(--ui-color-surface)" @select="selected=true">Vocal</UiMixerSlot>`
  }),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)
    const slot = canvas.getByLabelText("Vocal channel")
    await fireEvent.pointerDown(slot)
    await expect(slot).toHaveAttribute("aria-current", "true")
  }
}

export const MixerInsert: Story = {
  render: () => ({
    components: { UiButton, UiIconButton, UiMixerInsert },
    template: `
      <UiMixerInsert label="Compressor insert" style="width:148px;height:23px;color:var(--ui-color-text);background:var(--ui-color-surface-raised)">
        <UiButton variant="plain" size="sm" style="height:23px;min-height:23px">Compressor</UiButton>
        <template #leading><span aria-hidden="true">⋮</span></template>
        <template #actions><UiIconButton label="Bypass Compressor" density="compact">B</UiIconButton><UiIconButton label="Remove Compressor" density="compact">×</UiIconButton></template>
      </UiMixerInsert>
      <UiButton style="margin-top:16px">After insert</UiButton>
    `
  }),
  play: async ({ canvasElement }) => {
    const row = canvasElement.querySelector<HTMLElement>(".ui-mixer-insert")!
    await expect(row).toHaveAttribute("aria-label", "Compressor insert")
    const actions = canvasElement.querySelector<HTMLElement>(".ui-mixer-insert__actions")!
    await expect(getComputedStyle(actions).opacity).toBe("0")
    await fireEvent.pointerEnter(row)
    await expect(row).toHaveClass("is-hovered")
    await waitFor(() => expect(getComputedStyle(actions).opacity).toBe("1"))
    await fireEvent.pointerLeave(row)
    await userEvent.tab()
    await waitFor(() => expect(getComputedStyle(actions).opacity).toBe("1"))
    await userEvent.click(within(canvasElement).getByRole("button", { name: "After insert" }))
    await waitFor(() => expect(getComputedStyle(actions).opacity).toBe("0"))
  }
}

export const TrackQuickControls: Story = {
  render: () => ({
    components: { UiMixerStateButton, UiHorizontalFader, UiRotaryControl },
    data: () => ({ muted: false, gain: -6, pan: 0 }),
    template: `<div style="display:grid;grid-template-columns:74px minmax(64px,1fr) 23px;gap:2px;align-items:center;width:196px;height:23px">
      <div style="display:grid;grid-template-columns:repeat(4,17px);gap:2px">
        <UiMixerStateButton size="track" tone="mute" label="Mute track" :pressed="muted" @click="muted=!muted">M</UiMixerStateButton>
        <UiMixerStateButton size="track" tone="solo" label="Solo track" :pressed="false">S</UiMixerStateButton>
        <UiMixerStateButton size="track" tone="record" label="Arm track" :pressed="false">R</UiMixerStateButton>
        <UiMixerStateButton size="track" tone="input" label="Monitor track" :pressed="false">I</UiMixerStateButton>
      </div>
      <UiHorizontalFader :value="gain" :min="-90" :max="12" :step="0.1" :default-value="0" :meter-level-percent="68" label="Quick gain" @commit="gain=$event" />
      <UiRotaryControl :value="pan" :min="-64" :max="63" :step="1" :default-value="0" size="track" label="Quick pan" @commit="pan=$event" />
    </div>`
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const buttons = canvas.getAllByRole("button")
    let right = 0
    for (const button of buttons) {
      const box = button.getBoundingClientRect()
      await expect(box.width).toBe(17)
      await expect(box.height).toBe(17)
      await expect(box.left).toBeGreaterThanOrEqual(right)
      right = box.right + 2
    }
    await expect(
      canvas.getByRole("slider", { name: "Quick gain" }).getBoundingClientRect().left
    ).toBeGreaterThanOrEqual(right)
    await userEvent.click(buttons[0]!)
    await expect(buttons[0]!).toHaveAttribute("aria-pressed", "true")
    await userEvent.keyboard(" ")
    await expect(buttons[0]!).toHaveAttribute("aria-pressed", "false")
  }
}

export const TrackParameters: Story = {
  render: () => ({
    components: { UiHorizontalFader, UiRotaryControl, UiInlineTextEdit, UiButton },
    data: () => ({ gain: -6, pan: 0, meter: 68, raw: "-90" }),
    template: `
      <section style="display:grid;gap:12px;width:200px">
        <div style="display:grid;grid-template-columns:minmax(0,1fr) 23px;gap:4px;align-items:center">
          <UiHorizontalFader :value="gain" :min="-90" :max="12" :step="0.1" :default-value="0" :meter-level-percent="meter" label="Track volume" @preview="gain=$event" @commit="gain=$event" />
          <UiRotaryControl :value="pan" :min="-64" :max="63" :step="1" :default-value="0" :drag-range-pixels="254" size="track" double-click-action="edit" label="Track pan" value-label="Track pan value" @preview="pan=$event" @commit="pan=$event" />
        </div>
        <UiInlineTextEdit :value="raw" label="Mixer gain" input-type="number" density="compact" style="width:34px;height:20px;border:1px solid var(--ui-color-border);text-align:center" @commit="raw=$event">{{raw==='-90'?'−∞':raw}}</UiInlineTextEdit>
        <UiButton @click="meter=meter===0?68:0">Toggle signal</UiButton>
      </section>
    `
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.dblClick(canvas.getByRole("slider", { name: "Track pan" }))
    const editor = canvas.getByRole("spinbutton", { name: "Track pan value" })
    await userEvent.clear(editor)
    await userEvent.type(editor, "32{Enter}")
    await expect(canvas.getByRole("slider", { name: "Track pan" })).toHaveAttribute(
      "aria-valuetext",
      "32"
    )
  }
}

export const CurveEditor: Story = {
  render: () => ({
    components: { UiCurveEditor },
    data: () => ({
      handles: [{ id: "mid", label: "Midpoint", x: 0.5, y: 0.5 }]
    }),
    template: `
      <UiCurveEditor
        :curves="[{ id: 'main', points: [{ x: 0, y: 0 }, handles[0], { x: 1, y: 1 }] }]"
        :handles="handles"
        @move-handle="handles = handles.map((handle) => handle.id === $event.id ? { ...handle, ...$event } : handle)"
      />
    `
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const handle = canvas.getByRole("slider", { name: "Midpoint" })
    await userEvent.type(handle, "{ArrowUp}")
    await expect(handle).toHaveAttribute("aria-valuenow", "0.51")
  }
}

export const DbScale: Story = {
  render: () => ({
    components: { UiDbScale },
    data: () => ({
      marks: [
        { value: 0, label: "0", position: 0, emphasis: true },
        { value: -12, label: "−12", position: 25 },
        { value: -60, label: "−∞", position: 100 }
      ]
    }),
    template: `<div style="height:14rem;padding-inline:2rem"><UiDbScale :marks="marks" side="right" /></div>`
  })
}
