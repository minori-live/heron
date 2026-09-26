import { sql } from "drizzle-orm"
import {
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex
} from "drizzle-orm/pg-core"
import type { AudioBackend, LiveMidiControlTarget, MidiControlInputMode } from "@heron/contracts"
import { mixerChannelCoreColumns } from "./mixer-core-schema.ts"
import {
  mixerSends,
  pluginInstances,
  pluginSidechainRoutes,
  pluginStateChunks
} from "./mixer-schema.ts"

/** The Live lineage includes the Mixer core without Studio recording/system columns. */
export const mixerChannels = pgTable("mixer_channels", mixerChannelCoreColumns(), (table) => [
  foreignKey({
    columns: [table.outputChannelId],
    foreignColumns: [table.id],
    name: "mixer_channels_output_channel_id_fk"
  }).onDelete("restrict"),
  uniqueIndex("mixer_master_singleton")
    .on(table.kind)
    .where(sql`${table.kind} = 'master'`),
  uniqueIndex("mixer_output_channels_unique")
    .on(table.hardwareOutputChannels)
    .where(sql`${table.kind} = 'output'`),
  index("mixer_channel_sort_order").on(table.kind, table.sortOrder),
  check(
    "mixer_channels_kind_check",
    sql`${table.kind} in ('audio', 'instrument', 'aux', 'master', 'output')`
  ),
  check("mixer_channels_name_check", sql`length(trim(${table.name})) > 0`),
  check("mixer_channels_color_check", sql`${table.color} ~ '^#[0-9A-Fa-f]{6}$'`),
  check("mixer_channels_sort_order_check", sql`${table.sortOrder} >= 0`),
  check("mixer_channels_gain_db_check", sql`${table.gainDb} between -90 and 12`),
  check("mixer_channels_pan_check", sql`${table.pan} between -1 and 1`),
  check("mixer_channels_master_solo_check", sql`${table.kind} <> 'master' or not ${table.soloed}`),
  check(
    "mixer_channels_input_monitoring_check",
    sql`${table.kind} in ('audio', 'aux', 'instrument') or not ${table.inputMonitoring}`
  ),
  check(
    "mixer_channels_midi_input_check",
    sql`(
      ${table.kind} = 'instrument'
      and ((${table.midiInputPortId} is null and ${table.midiInputPortName} is null)
        or (${table.midiInputPortId} is not null and ${table.midiInputPortName} is not null))
      and (${table.midiInputChannel} is null or ${table.midiInputChannel} between 0 and 15)
    ) or (
      ${table.kind} <> 'instrument'
      and ${table.midiInputPortId} is null
      and ${table.midiInputPortName} is null
      and ${table.midiInputChannel} is null
    )`
  ),
  check(
    "mixer_channels_output_route_check",
    sql`(
      ${table.kind} in ('master', 'output')
      and ${table.outputChannelId} is null and ${table.outputBus} is null
    ) or (
      ${table.kind} not in ('master', 'output')
      and num_nonnulls(${table.outputChannelId}, ${table.outputBus}) = 1
    )`
  ),
  check(
    "mixer_channels_output_bus_check",
    sql`${table.outputBus} is null or ${table.outputBus} between 1 and 256`
  ),
  check(
    "mixer_channels_input_check",
    sql`(
      ${table.kind} in ('audio', 'aux')
      and ${table.inputSource} is not null and ${table.inputFormat} is not null
      and ((${table.inputFormat} = 'mono' and cardinality(${table.inputChannels}) = 1)
        or (${table.inputFormat} = 'stereo' and cardinality(${table.inputChannels}) = 2
          and ${table.inputChannels}[1] <> ${table.inputChannels}[2]))
    ) or (
      ${table.kind} not in ('audio', 'aux')
      and ${table.inputSource} is null and ${table.inputFormat} is null
      and cardinality(${table.inputChannels}) = 0
    )`
  ),
  check(
    "mixer_channels_input_channels_check",
    sql`(
      ${table.inputSource} is null or (
        0 < all(${table.inputChannels})
        and ((${table.inputSource} = 'hardware' and 32 >= all(${table.inputChannels}))
          or (${table.inputSource} = 'bus' and 256 >= all(${table.inputChannels}))
          or (${table.inputSource} = 'application' and 2 >= all(${table.inputChannels})))
      )
    )`
  ),
  check(
    "mixer_channels_application_capture_check",
    sql`(
      (${table.inputSource} = 'application' and ${table.applicationCapture} is not null)
      or (${table.inputSource} <> 'application' and ${table.applicationCapture} is null)
      or (${table.inputSource} is null and ${table.applicationCapture} is null)
    )`
  ),
  check(
    "mixer_channels_hardware_output_check",
    sql`(
      ${table.kind} = 'output'
      and cardinality(${table.hardwareOutputChannels}) = 2
      and ${table.hardwareOutputChannels}[1] <> ${table.hardwareOutputChannels}[2]
      and 0 < all(${table.hardwareOutputChannels})
    ) or (
      ${table.kind} <> 'output' and cardinality(${table.hardwareOutputChannels}) = 0
    )`
  )
])

export { mixerSends, pluginInstances, pluginSidechainRoutes, pluginStateChunks }

export const LIVE_DOCUMENT_ID = "document"
export const LIVE_FORMAT_VERSION = 1

export const liveDocument = pgTable(
  "live_document",
  {
    id: text("id").primaryKey(),
    kind: text("kind").$type<"live">().notNull().default("live"),
    formatVersion: integer("format_version").notNull().default(LIVE_FORMAT_VERSION),
    name: text("name").notNull(),
    sampleRate: integer("sample_rate").notNull(),
    backend: text("backend").$type<AudioBackend>(),
    inputDeviceId: text("input_device_id"),
    outputDeviceId: text("output_device_id"),
    bufferSize: integer("buffer_size"),
    enabledMidiDeviceIds: text("enabled_midi_device_ids")
      .array()
      .$type<string[]>()
      .notNull()
      .default(sql`array[]::text[]`),
    revision: integer("revision").notNull().default(0)
  },
  (table) => [
    check("live_document_singleton", sql`${table.id} = 'document'`),
    check("live_document_kind", sql`${table.kind} = 'live'`),
    check("live_document_version", sql`${table.formatVersion} >= 1`),
    check("live_document_name", sql`length(trim(${table.name})) > 0`),
    check(
      "live_document_sample_rate",
      sql`${table.sampleRate} in (44100, 48000, 88200, 96000, 176400, 192000)`
    ),
    check(
      "live_document_buffer",
      sql`${table.bufferSize} is null or ${table.bufferSize} between 16 and 16384`
    ),
    check("live_document_revision", sql`${table.revision} >= 0`)
  ]
)

export const liveMidiBindings = pgTable(
  "live_midi_bindings",
  {
    id: text("id").primaryKey(),
    portId: text("port_id").notNull(),
    channel: smallint("channel").notNull(),
    messageKind: text("message_kind").$type<"note" | "control-change">().notNull(),
    number: smallint("number").notNull(),
    inputMode: jsonb("input_mode").$type<MidiControlInputMode>().notNull(),
    target: jsonb("target").$type<LiveMidiControlTarget>().notNull(),
    transformProfileId: text("transform_profile_id")
  },
  (table) => [
    index("live_midi_binding_address").on(
      table.portId,
      table.channel,
      table.messageKind,
      table.number
    ),
    check("live_midi_binding_channel", sql`${table.channel} between 0 and 15`),
    check("live_midi_binding_number", sql`${table.number} between 0 and 127`),
    check("live_midi_binding_kind", sql`${table.messageKind} in ('note', 'control-change')`),
    check("live_midi_binding_port", sql`length(trim(${table.portId})) > 0`)
  ]
)

export const livePluginParameterValues = pgTable(
  "live_plugin_parameter_values",
  {
    pluginId: text("plugin_id")
      .notNull()
      .references(() => pluginInstances.id, { onDelete: "cascade" }),
    parameterKey: text("parameter_key").notNull(),
    value: doublePrecision("value").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.pluginId, table.parameterKey] }),
    check("live_plugin_parameter_key", sql`length(trim(${table.parameterKey})) > 0`)
  ]
)
