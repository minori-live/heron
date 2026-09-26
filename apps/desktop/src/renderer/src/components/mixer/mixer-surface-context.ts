import type { InjectionKey } from "vue"
import type { MixerChannelCoreState, MixerChannelMeter, MixerChannelState } from "@heron/contracts"

/** Studio extensions are optional: a Live channel has no Track or recording state. */
export type MixerStripChannel = MixerChannelCoreState &
  Partial<Pick<MixerChannelState, "systemRole" | "recordArmed">>

export type MixerMeterSource = (channelId: string) => MixerChannelMeter | undefined

/** Keep high-frequency telemetry reads inside each meter, independent of document ownership. */
export const mixerMeterSourceKey: InjectionKey<MixerMeterSource> = Symbol("mixer-meter-source")
