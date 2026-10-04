import type { Meta, StoryObj } from "@storybook/vue3-vite"
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
    logarithmic: true,
    series: [
      { label: "L", x, y: x.map((hz) => -10 * Math.log10(1 + (hz / 4000) ** 2)) },
      { label: "R", x, y: x.map((hz) => -10 * Math.log10(1 + (hz / 6000) ** 2)) }
    ]
  },
  decorators: [() => ({ template: '<div style="height:440px"><story /></div>' })]
} satisfies Meta<typeof UiAnalysisPlot>
export default meta
type Story = StoryObj<typeof meta>
export const StereoResponse: Story = {}
export const SweepSpectrogram: Story = {
  args: {
    label: "Sweep spectrum",
    logarithmic: false,
    series: [],
    xLabel: "s",
    yLabel: "Hz",
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
