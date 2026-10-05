import type { Meta, StoryObj } from "@storybook/vue3-vite"
import { expect, waitFor, within } from "storybook/test"
import UiAnalysisPlot from "./UiAnalysisPlot.vue"

const x = Array.from({ length: 160 }, (_, i) => 20 * 1000 ** (i / 159))
const meta = {
  title: "Components/Workspace/Analysis plot",
  component: UiAnalysisPlot,
  tags: ["autodocs"],
  args: {
    label: "Stereo response",
    xLabel: "Hz",
    yLabel: "dB",
    xUnit: "Hz",
    yUnit: "dB",
    xMinimumStep: 1,
    yMinimumStep: 1,
    logarithmic: true,
    smooth: true,
    series: [
      { label: "L", x, y: x.map((hz) => -10 * Math.log10(1 + (hz / 4000) ** 2)) },
      { label: "R", x, y: x.map((hz) => -10 * Math.log10(1 + (hz / 6000) ** 2)) }
    ]
  },
  decorators: [() => ({ template: '<div style="height:440px"><story /></div>' })]
} satisfies Meta<typeof UiAnalysisPlot>
export default meta
type Story = StoryObj<typeof meta>
async function hoverMeasurement(
  canvasElement: HTMLElement,
  xFraction: number,
  yFraction: number,
  heatmap = false,
  measurementLabel = "dB:"
): Promise<HTMLElement> {
  const plot = within(canvasElement).getByRole("img")
  await waitFor(() => expect(plot.querySelector("canvas")).not.toBeNull())
  await waitFor(async () => {
    const rect = plot.getBoundingClientRect()
    plot.querySelector("canvas")!.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: rect.left + 96 + (rect.width - (heatmap ? 196 : 118)) * xFraction,
        clientY: rect.top + 18 + (rect.height - 64) * (1 - yFraction)
      })
    )
    await expect(plot).toHaveTextContent(heatmap ? "dBFS" : measurementLabel)
  })
  return plot
}
export const StereoResponse: Story = {
  play: async ({ canvasElement }) => {
    const plot = await hoverMeasurement(canvasElement, 80 / 159, 0.5)
    await waitFor(async () => {
      await expect(plot).toHaveTextContent(`Hz: ${Number(x[80]!.toPrecision(8))}`)
      await expect(plot).toHaveTextContent(
        `dB: ${Number((-10 * Math.log10(1 + (x[80]! / 4000) ** 2)).toPrecision(8))}`
      )
      await expect(plot).toHaveTextContent("R")
    })
  }
}
export const SweepSpectrogram: Story = {
  play: async ({ canvasElement }) => {
    const plot = await hoverMeasurement(canvasElement, 48 / 95, 104.5 / 128, true)
    await waitFor(async () => {
      await expect(plot).toHaveTextContent("s: 3.0315789")
      await expect(plot).toHaveTextContent("Hz: 19500–19687.5")
      await expect(plot).toHaveTextContent("-24 dBFS")
    })
  },
  args: {
    label: "Sweep spectrum",
    logarithmic: false,
    series: [],
    xLabel: "s",
    yLabel: "Hz",
    xUnit: "s",
    yUnit: "Hz",
    xMinimumStep: 0.001,
    xDomain: [0, 6],
    yDomain: [0, 24000],
    heatmap: {
      columns: 96,
      rows: 128,
      values: Array.from({ length: 96 * 128 }, (_, i) => {
        const column = Math.floor(i / 128)
        const row = i % 128
        const fundamental = 4 + column
        return Math.abs(row - fundamental) < 2
          ? 0
          : Math.abs(row - fundamental * 2) < 2
            ? -24
            : -120
      })
    }
  }
}
export const NearZeroPhase: Story = {
  args: {
    label: "Phase response",
    yLabel: "°",
    yUnit: "°",
    series: [{ label: "L", x, y: x.map((_, i) => Math.sin(i) * 1e-8) }]
  },
  play: async ({ canvasElement }) => {
    const plot = await hoverMeasurement(canvasElement, 80 / 159, 0.5, false, "°:")
    await expect(plot).toHaveTextContent(`°: ${Number((Math.sin(80) * 1e-8).toPrecision(8))}`)
  }
}
