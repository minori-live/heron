import { sql } from "drizzle-orm"
import type { ApplicationCaptureTarget } from "@heron/contracts"
import { boolean, doublePrecision, integer, jsonb, smallint, text } from "drizzle-orm/pg-core"

/** Fresh Drizzle builders for the physical columns shared by Studio and Live. */
export function mixerChannelCoreColumns() {
  return {
    id: text("id").primaryKey(),
    kind: text("kind").$type<"audio" | "instrument" | "aux" | "master" | "output">().notNull(),
    name: text("name").notNull(),
    color: text("color").notNull(),
    sortOrder: integer("sort_order").notNull(),
    inputSource: text("input_source").$type<"hardware" | "bus" | "application">(),
    inputFormat: text("input_format").$type<"mono" | "stereo">(),
    applicationCapture: jsonb("application_capture").$type<ApplicationCaptureTarget | null>(),
    midiInputPortId: text("midi_input_port_id"),
    midiInputPortName: text("midi_input_port_name"),
    midiInputChannel: smallint("midi_input_channel"),
    gainDb: doublePrecision("gain_db").notNull().default(0),
    pan: doublePrecision("pan").notNull().default(0),
    muted: boolean("muted").notNull().default(false),
    soloed: boolean("soloed").notNull().default(false),
    outputChannelId: text("output_channel_id"),
    outputBus: smallint("output_bus"),
    inputMonitoring: boolean("input_monitoring").notNull().default(false),
    inputChannels: smallint("input_channels")
      .array()
      .$type<number[]>()
      .notNull()
      .default(sql`array[]::smallint[]`),
    hardwareOutputChannels: smallint("hardware_output_channels")
      .array()
      .$type<number[]>()
      .notNull()
      .default(sql`array[]::smallint[]`)
  }
}
