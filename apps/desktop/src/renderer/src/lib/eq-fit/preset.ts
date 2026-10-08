import type { EqSection } from "./biquad"

/** Versioned static-band interchange with the native Heron EQ editor. The fitted RBJ
 * sections retain their coefficients with slope setting 12 in Zero Latency mode. */
export function heronEqPreset(sections: readonly EqSection[], overallGainDb: number): string {
  return JSON.stringify(
    {
      format: "heron-eq",
      version: 1,
      config: {
        bands: sections.map((section, index) => ({
          id: index + 1,
          enabled: true,
          shape: section.type,
          frequency_hz: section.frequencyHz,
          gain_db: section.gainDb,
          q: section.q,
          slope_db_oct: 12,
          channel: "Stereo"
        })),
        output_gain_db: overallGainDb,
        bypass: false,
        processing_mode: "ZeroLatency"
      }
    },
    null,
    2
  )
}
