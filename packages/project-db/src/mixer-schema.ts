import { sql } from "drizzle-orm"
import type { PluginAudioMode, PluginFormat } from "@heron/contracts"
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex
} from "drizzle-orm/pg-core"
import { mixerChannelCoreColumns } from "./mixer-core-schema.ts"
import { bytea } from "./schema-types.ts"

/** Shared Mixer tables; Studio ownership relations are added by schema.ts. */
export const mixerChannels = pgTable(
  "mixer_channels",
  {
    ...mixerChannelCoreColumns(),
    systemRole: text("system_role").$type<"metronome">(),
    recordArmed: boolean("record_armed").notNull().default(false)
  },
  (table) => [
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
    uniqueIndex("mixer_system_role_singleton")
      .on(table.systemRole)
      .where(sql`${table.systemRole} is not null`),
    index("mixer_channel_sort_order").on(table.kind, table.sortOrder),
    check(
      "mixer_channels_kind_check",
      sql`${table.kind} in ('audio', 'instrument', 'aux', 'master', 'output')`
    ),
    check(
      "mixer_channels_system_role_check",
      sql`${table.systemRole} is null or ${table.systemRole} = 'metronome'`
    ),
    check(
      "mixer_channels_system_role_kind_check",
      sql`${table.systemRole} is null or ${table.kind} = 'instrument'`
    ),
    check("mixer_channels_name_check", sql`length(trim(${table.name})) > 0`),
    check("mixer_channels_color_check", sql`${table.color} ~ '^#[0-9A-Fa-f]{6}$'`),
    check("mixer_channels_sort_order_check", sql`${table.sortOrder} >= 0`),
    check("mixer_channels_gain_db_check", sql`${table.gainDb} between -90 and 12`),
    check("mixer_channels_pan_check", sql`${table.pan} between -1 and 1`),
    check(
      "mixer_channels_master_solo_check",
      sql`${table.kind} <> 'master' or not ${table.soloed}`
    ),
    check(
      "mixer_channels_input_monitoring_check",
      sql`(${table.kind} in ('audio', 'aux') or (${table.kind} = 'instrument' and ${table.systemRole} is null))
        or not ${table.inputMonitoring}`
    ),
    check(
      "mixer_channels_record_armed_check",
      sql`(${table.kind} = 'audio' or (${table.kind} = 'instrument' and ${table.systemRole} is null))
        or not ${table.recordArmed}`
    ),
    check(
      "mixer_channels_midi_input_check",
      sql`(
        ${table.kind} = 'instrument'
        and ${table.systemRole} is null
        and (
          (${table.midiInputPortId} is null and ${table.midiInputPortName} is null)
          or (${table.midiInputPortId} is not null and ${table.midiInputPortName} is not null)
        )
        and (${table.midiInputChannel} is null or ${table.midiInputChannel} between 0 and 15)
      ) or (
        not (${table.kind} = 'instrument' and ${table.systemRole} is null)
        and ${table.midiInputPortId} is null
        and ${table.midiInputPortName} is null
        and ${table.midiInputChannel} is null
      )`
    ),
    check(
      "mixer_channels_output_route_check",
      sql`(
        ${table.kind} in ('master', 'output')
        and ${table.outputChannelId} is null
        and ${table.outputBus} is null
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
      and ${table.inputSource} is not null
      and ${table.inputFormat} is not null
      and (
        (${table.inputFormat} = 'mono' and cardinality(${table.inputChannels}) = 1)
        or (
          ${table.inputFormat} = 'stereo'
          and cardinality(${table.inputChannels}) = 2
          and ${table.inputChannels}[1] <> ${table.inputChannels}[2]
        )
      )
    ) or (
      ${table.kind} not in ('audio', 'aux')
      and ${table.inputSource} is null
      and ${table.inputFormat} is null
      and cardinality(${table.inputChannels}) = 0
    )`
    ),
    check(
      "mixer_channels_input_channels_check",
      sql`(
        ${table.inputSource} is null
        or (
          0 < all(${table.inputChannels})
          and (
            (${table.inputSource} = 'hardware' and 32 >= all(${table.inputChannels}))
            or (${table.inputSource} = 'bus' and 256 >= all(${table.inputChannels}))
            or (${table.inputSource} = 'application' and 2 >= all(${table.inputChannels}))
          )
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
      ${table.kind} <> 'output'
      and cardinality(${table.hardwareOutputChannels}) = 0
    )`
    )
  ]
)

export const mixerSends = pgTable(
  "mixer_sends",
  {
    id: text("id").primaryKey(),
    sourceChannelId: text("source_channel_id")
      .notNull()
      .references(() => mixerChannels.id, { onDelete: "cascade" }),
    targetChannelId: text("target_channel_id").references(() => mixerChannels.id, {
      onDelete: "cascade"
    }),
    targetBus: smallint("target_bus"),
    sortOrder: integer("sort_order").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    tap: text("tap").$type<"pre" | "post" | "post-pan">().notNull().default("post-pan"),
    levelDb: doublePrecision("level_db").notNull().default(-90)
  },
  (table) => [
    uniqueIndex("mixer_sends_source_bus_unique")
      .on(table.sourceChannelId, table.targetBus)
      .where(sql`${table.targetBus} is not null`),
    uniqueIndex("mixer_sends_source_output_unique")
      .on(table.sourceChannelId, table.targetChannelId)
      .where(sql`${table.targetChannelId} is not null`),
    index("mixer_sends_source_order").on(table.sourceChannelId, table.sortOrder),
    check("mixer_sends_sort_order_check", sql`${table.sortOrder} >= 0`),
    check("mixer_sends_tap_check", sql`${table.tap} in ('pre', 'post', 'post-pan')`),
    check("mixer_sends_level_db_check", sql`${table.levelDb} between -90 and 12`),
    check(
      "mixer_sends_target_check",
      sql`num_nonnulls(${table.targetChannelId}, ${table.targetBus}) = 1
        and (${table.targetBus} is null or ${table.targetBus} between 1 and 256)`
    )
  ]
)

export const pluginInstances = pgTable(
  "plugin_instances",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => mixerChannels.id, { onDelete: "cascade" }),
    role: text("role").$type<"instrument" | "insert">().notNull(),
    slotOrder: integer("slot_order").notNull(),
    locatorFormat: text("locator_format").$type<PluginFormat>().notNull(),
    artifactPath: text("artifact_path").notNull(),
    nativeId: text("native_id").notNull(),
    descriptorSnapshot: text("descriptor_snapshot").notNull(),
    audioMode: text("audio_mode").$type<PluginAudioMode>().notNull().default("stereo"),
    enabled: boolean("enabled").notNull().default(true),
    controlAlias: text("control_alias")
  },
  (table) => [
    uniqueIndex("plugin_instances_channel_role_slot_unique").on(
      table.channelId,
      table.role,
      table.slotOrder
    ),
    uniqueIndex("plugin_instances_instrument_singleton")
      .on(table.channelId)
      .where(sql`${table.role} = 'instrument'`),
    uniqueIndex("plugin_instances_control_alias_unique")
      .on(table.controlAlias)
      .where(sql`${table.controlAlias} is not null`),
    index("plugin_instances_channel_order").on(table.channelId, table.role, table.slotOrder),
    check("plugin_instances_role_check", sql`${table.role} in ('instrument', 'insert')`),
    check("plugin_instances_format_check", sql`${table.locatorFormat} in ('vst3', 'clap')`),
    check(
      "plugin_instances_audio_mode_check",
      sql`${table.audioMode} in ('mono', 'mono-to-stereo', 'stereo', 'dual-mono')`
    ),
    check("plugin_instances_slot_order_check", sql`${table.slotOrder} >= 0`),
    check(
      "plugin_instances_control_alias_check",
      sql`${table.controlAlias} is null or (
        octet_length(${table.controlAlias}) between 1 and 64
        and ${table.controlAlias} ~ '^[a-z0-9][a-z0-9._-]*$'
      )`
    ),
    check(
      "plugin_instances_instrument_slot_check",
      sql`${table.role} <> 'instrument' or ${table.slotOrder} = 0`
    )
  ]
)

export const pluginStateChunks = pgTable(
  "plugin_state_chunks",
  {
    pluginId: text("plugin_id")
      .notNull()
      .references(() => pluginInstances.id, { onDelete: "cascade" }),
    chunkKey: text("chunk_key").notNull(),
    bytes: bytea("bytes")
      .notNull()
      .default(sql`''::bytea`)
  },
  (table) => [
    primaryKey({ columns: [table.pluginId, table.chunkKey] }),
    check("plugin_state_chunks_key_check", sql`length(${table.chunkKey}) > 0`)
  ]
)

export const pluginSidechainRoutes = pgTable(
  "plugin_sidechain_routes",
  {
    pluginId: text("plugin_id")
      .notNull()
      .references(() => pluginInstances.id, { onDelete: "cascade" }),
    inputPortKey: text("input_port_key").notNull(),
    sourceChannelId: text("source_channel_id")
      .notNull()
      .references(() => mixerChannels.id, { onDelete: "cascade" })
  },
  (table) => [
    primaryKey({ columns: [table.pluginId, table.inputPortKey] }),
    index("plugin_sidechain_routes_source_channel").on(table.sourceChannelId),
    check("plugin_sidechain_routes_port_key_check", sql`length(${table.inputPortKey}) > 0`)
  ]
)
