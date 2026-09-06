import { pgOid, bytea, int8Number, int8BigInt } from "./schema-types.ts"
export { pgOid, bytea, int8Number, int8BigInt } from "./schema-types.ts"
import {
  mixerChannels,
  mixerSends,
  pluginInstances,
  pluginStateChunks,
  pluginSidechainRoutes
} from "./mixer-schema.ts"
export {
  mixerChannels,
  mixerSends,
  pluginInstances,
  pluginStateChunks,
  pluginSidechainRoutes
} from "./mixer-schema.ts"
import { relations, sql } from "drizzle-orm"
import {
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex
} from "drizzle-orm/pg-core"

export const PROJECT_SAMPLE_RATES = [44_100, 48_000, 88_200, 96_000, 176_400, 192_000] as const
export type ProjectSampleRate = (typeof PROJECT_SAMPLE_RATES)[number]

export const PROJECT_ID = "project"
export const WAVEFORM_CACHE_VERSION = 1

export const project = pgTable(
  "project",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    sampleRate: integer("sample_rate").notNull(),
    waveformDisplayMode: text("waveform_display_mode").$type<"separate" | "aggregate">().notNull(),
    notes: text("notes").notNull().default(""),
    projectEndTick: integer("project_end_tick").notNull().default(61_440)
  },
  (table) => [
    check("project_singleton_id_check", sql`${table.id} = 'project'`),
    check("project_name_check", sql`length(trim(${table.name})) > 0`),
    check(
      "project_sample_rate_check",
      sql`${table.sampleRate} in (44100, 48000, 88200, 96000, 176400, 192000)`
    ),
    check(
      "project_waveform_display_mode_check",
      sql`${table.waveformDisplayMode} in ('separate', 'aggregate')`
    ),
    check("project_end_tick_check", sql`${table.projectEndTick} > 0`)
  ]
)

export const assets = pgTable(
  "assets",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    mimeType: text("mime_type").$type<"audio/x-bwf">().notNull(),
    contentHash: text("content_hash").notNull(),
    byteLength: int8BigInt("byte_length").notNull(),
    sampleRate: integer("sample_rate").notNull(),
    channels: smallint("channels").notNull(),
    bitDepth: text("bit_depth").$type<"float32" | "pcm24" | "pcm16">().notNull(),
    frameCount: int8BigInt("frame_count").notNull(),
    bwfTimeReference: int8BigInt("bwf_time_reference").notNull(),
    largeObjectOid: pgOid("large_object_oid").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("assets_content_hash_unique").on(table.contentHash),
    uniqueIndex("assets_large_object_oid_unique").on(table.largeObjectOid),
    index("assets_created_at_index").on(table.createdAt, table.id),
    check("assets_name_check", sql`length(trim(${table.name})) > 0`),
    check("assets_mime_type_check", sql`${table.mimeType} = 'audio/x-bwf'`),
    check("assets_byte_length_check", sql`${table.byteLength} >= 0`),
    check("assets_sample_rate_check", sql`${table.sampleRate} > 0`),
    check("assets_channels_check", sql`${table.channels} > 0`),
    check("assets_bit_depth_check", sql`${table.bitDepth} in ('float32', 'pcm24', 'pcm16')`),
    check("assets_frame_count_check", sql`${table.frameCount} >= 0`),
    check("assets_bwf_time_reference_check", sql`${table.bwfTimeReference} >= 0`)
  ]
)

export const assetWaveformLevels = pgTable(
  "asset_waveform_levels",
  {
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    cacheVersion: smallint("cache_version").notNull(),
    level: smallint("level").notNull(),
    framesPerBucket: integer("frames_per_bucket").notNull(),
    bucketCount: integer("bucket_count").notNull(),
    channels: smallint("channels").notNull(),
    sampleRate: integer("sample_rate").notNull(),
    frameCount: int8BigInt("frame_count").notNull(),
    peaks: bytea("peaks").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.assetId, table.cacheVersion, table.level] }),
    check("asset_waveform_levels_cache_version_check", sql`${table.cacheVersion} > 0`),
    check("asset_waveform_levels_level_check", sql`${table.level} >= 0`),
    check("asset_waveform_levels_frames_per_bucket_check", sql`${table.framesPerBucket} > 0`),
    check("asset_waveform_levels_bucket_count_check", sql`${table.bucketCount} >= 0`),
    check("asset_waveform_levels_channels_check", sql`${table.channels} > 0`),
    check("asset_waveform_levels_sample_rate_check", sql`${table.sampleRate} > 0`),
    check("asset_waveform_levels_frame_count_check", sql`${table.frameCount} >= 0`),
    check(
      "asset_waveform_levels_peaks_length_check",
      sql`octet_length(${table.peaks}) = ${table.bucketCount} * ${table.channels} * 8`
    )
  ]
)

export const tracks = pgTable(
  "tracks",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => mixerChannels.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull(),
    notes: text("notes").notNull().default("")
  },
  (table) => [
    uniqueIndex("tracks_channel_id_unique").on(table.channelId),
    index("tracks_sort_order_index").on(table.sortOrder, table.id),
    check("tracks_sort_order_check", sql`${table.sortOrder} >= 0`)
  ]
)

export const audioClips = pgTable(
  "audio_clips",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    trackId: text("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    startFrame: int8BigInt("start_frame").notNull(),
    sourceOffsetFrames: int8BigInt("source_offset_frames")
      .notNull()
      .default(sql`0`),
    lengthFrames: int8BigInt("length_frames").notNull(),
    fadeInFrames: int8BigInt("fade_in_frames")
      .notNull()
      .default(sql`0`),
    fadeOutFrames: int8BigInt("fade_out_frames")
      .notNull()
      .default(sql`0`)
  },
  (table) => [
    index("audio_clips_track_start").on(table.trackId, table.startFrame),
    check("audio_clips_name_check", sql`length(trim(${table.name})) > 0`),
    check("audio_clips_start_frame_check", sql`${table.startFrame} >= 0`),
    check("audio_clips_source_offset_frames_check", sql`${table.sourceOffsetFrames} >= 0`),
    check("audio_clips_length_frames_check", sql`${table.lengthFrames} > 0`),
    check("audio_clips_fade_in_frames_check", sql`${table.fadeInFrames} >= 0`),
    check("audio_clips_fade_out_frames_check", sql`${table.fadeOutFrames} >= 0`),
    check(
      "audio_clips_fade_length_check",
      sql`${table.fadeInFrames} + ${table.fadeOutFrames} <= ${table.lengthFrames}`
    )
  ]
)

export const tempoEvents = pgTable(
  "tempo_events",
  {
    tick: int8Number("tick").primaryKey(),
    beatsPerMinute: doublePrecision("beats_per_minute").notNull()
  },
  (table) => [
    check("tempo_events_tick_check", sql`${table.tick} >= 0`),
    check("tempo_events_beats_per_minute_check", sql`${table.beatsPerMinute} > 0`)
  ]
)

export const timeSignatureEvents = pgTable(
  "time_signature_events",
  {
    tick: int8Number("tick").primaryKey(),
    numerator: smallint("numerator").notNull(),
    denominator: smallint("denominator").notNull()
  },
  (table) => [
    check("time_signature_events_tick_check", sql`${table.tick} >= 0`),
    check("time_signature_events_numerator_check", sql`${table.numerator} between 1 and 32`),
    check(
      "time_signature_events_denominator_check",
      sql`${table.denominator} in (1, 2, 4, 8, 16, 32)`
    )
  ]
)

export const keySignatureEvents = pgTable(
  "key_signature_events",
  {
    tick: int8Number("tick").primaryKey(),
    fifths: smallint("fifths").notNull(),
    mode: text("mode").notNull()
  },
  (table) => [
    check("key_signature_events_tick_check", sql`${table.tick} >= 0`),
    check("key_signature_events_fifths_check", sql`${table.fifths} between -7 and 7`),
    check("key_signature_events_mode_check", sql`${table.mode} in ('major', 'minor')`)
  ]
)

export const midiSources = pgTable(
  "midi_sources",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    contentHash: text("content_hash").notNull(),
    rawBytes: bytea("raw_bytes").notNull()
  },
  (table) => [
    uniqueIndex("midi_sources_content_hash_unique").on(table.contentHash),
    check("midi_sources_name_check", sql`length(trim(${table.name})) > 0`)
  ]
)

export const midiClips = pgTable(
  "midi_clips",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => midiSources.id, { onDelete: "restrict" }),
    trackId: text("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    startTick: int8Number("start_tick").notNull(),
    lengthTicks: int8Number("length_ticks").notNull(),
    sourceOffsetTicks: int8Number("source_offset_ticks").notNull().default(0),
    sourceLengthTicks: int8Number("source_length_ticks").notNull()
  },
  (table) => [
    index("midi_clips_track_start").on(table.trackId, table.startTick),
    check("midi_clips_name_check", sql`length(trim(${table.name})) > 0`),
    check("midi_clips_start_tick_check", sql`${table.startTick} >= 0`),
    check("midi_clips_length_ticks_check", sql`${table.lengthTicks} > 0`),
    check("midi_clips_source_offset_ticks_check", sql`${table.sourceOffsetTicks} >= 0`),
    check("midi_clips_source_length_ticks_check", sql`${table.sourceLengthTicks} > 0`),
    check(
      "midi_clips_source_window_check",
      sql`${table.sourceOffsetTicks} + ${table.lengthTicks} <= ${table.sourceLengthTicks}`
    )
  ]
)

export const midiNotes = pgTable(
  "midi_notes",
  {
    id: text("id").primaryKey(),
    clipId: text("clip_id")
      .notNull()
      .references(() => midiClips.id, { onDelete: "cascade" }),
    startTick: int8Number("start_tick").notNull(),
    durationTicks: int8Number("duration_ticks").notNull(),
    channel: smallint("channel").notNull(),
    key: smallint("key").notNull(),
    velocity: smallint("velocity").notNull(),
    releaseVelocity: smallint("release_velocity").notNull()
  },
  (table) => [
    index("midi_notes_clip_start").on(table.clipId, table.startTick),
    check("midi_notes_start_tick_check", sql`${table.startTick} >= 0`),
    check("midi_notes_duration_ticks_check", sql`${table.durationTicks} > 0`),
    check("midi_notes_channel_check", sql`${table.channel} between 0 and 15`),
    check("midi_notes_key_check", sql`${table.key} between 0 and 127`),
    check("midi_notes_velocity_check", sql`${table.velocity} between 1 and 127`),
    check("midi_notes_release_velocity_check", sql`${table.releaseVelocity} between 0 and 127`)
  ]
)

export const midiEvents = pgTable(
  "midi_events",
  {
    id: text("id").primaryKey(),
    clipId: text("clip_id")
      .notNull()
      .references(() => midiClips.id, { onDelete: "cascade" }),
    tick: int8Number("tick").notNull(),
    channel: smallint("channel"),
    kind: text("kind")
      .$type<
        | "control-change"
        | "pitch-bend"
        | "program-change"
        | "channel-pressure"
        | "poly-pressure"
        | "sysex"
      >()
      .notNull(),
    data: bytea("data").notNull()
  },
  (table) => [
    index("midi_events_clip_tick").on(table.clipId, table.tick),
    check("midi_events_tick_check", sql`${table.tick} >= 0`),
    check(
      "midi_events_channel_check",
      sql`${table.channel} is null or ${table.channel} between 0 and 15`
    ),
    check(
      "midi_events_kind_check",
      sql`${table.kind} in (
      'control-change', 'pitch-bend', 'program-change',
      'channel-pressure', 'poly-pressure', 'sysex'
    )`
    )
  ]
)

export const assetsRelations = relations(assets, ({ many }) => ({
  waveformLevels: many(assetWaveformLevels),
  audioClips: many(audioClips)
}))

export const assetWaveformLevelsRelations = relations(assetWaveformLevels, ({ one }) => ({
  asset: one(assets, {
    fields: [assetWaveformLevels.assetId],
    references: [assets.id]
  })
}))

export const mixerChannelsRelations = relations(mixerChannels, ({ many, one }) => ({
  outputChannel: one(mixerChannels, {
    fields: [mixerChannels.outputChannelId],
    references: [mixerChannels.id],
    relationName: "channelOutput"
  }),
  routedChannels: many(mixerChannels, { relationName: "channelOutput" }),
  track: one(tracks),
  plugins: many(pluginInstances),
  sourcedSends: many(mixerSends, { relationName: "sendSource" }),
  targetedSends: many(mixerSends, { relationName: "sendTarget" }),
  sourcedPluginSidechains: many(pluginSidechainRoutes, { relationName: "sidechainSource" })
}))

export const tracksRelations = relations(tracks, ({ many, one }) => ({
  channel: one(mixerChannels, {
    fields: [tracks.channelId],
    references: [mixerChannels.id]
  }),
  audioClips: many(audioClips),
  midiClips: many(midiClips)
}))

export const audioClipsRelations = relations(audioClips, ({ one }) => ({
  asset: one(assets, {
    fields: [audioClips.assetId],
    references: [assets.id]
  }),
  track: one(tracks, {
    fields: [audioClips.trackId],
    references: [tracks.id]
  })
}))

export const mixerSendsRelations = relations(mixerSends, ({ one }) => ({
  sourceChannel: one(mixerChannels, {
    fields: [mixerSends.sourceChannelId],
    references: [mixerChannels.id],
    relationName: "sendSource"
  }),
  targetChannel: one(mixerChannels, {
    fields: [mixerSends.targetChannelId],
    references: [mixerChannels.id],
    relationName: "sendTarget"
  })
}))

export const pluginInstancesRelations = relations(pluginInstances, ({ many, one }) => ({
  channel: one(mixerChannels, {
    fields: [pluginInstances.channelId],
    references: [mixerChannels.id]
  }),
  sidechainRoutes: many(pluginSidechainRoutes),
  stateChunks: many(pluginStateChunks)
}))

export const pluginStateChunksRelations = relations(pluginStateChunks, ({ one }) => ({
  plugin: one(pluginInstances, {
    fields: [pluginStateChunks.pluginId],
    references: [pluginInstances.id]
  })
}))

export const pluginSidechainRoutesRelations = relations(pluginSidechainRoutes, ({ one }) => ({
  plugin: one(pluginInstances, {
    fields: [pluginSidechainRoutes.pluginId],
    references: [pluginInstances.id]
  }),
  sourceChannel: one(mixerChannels, {
    fields: [pluginSidechainRoutes.sourceChannelId],
    references: [mixerChannels.id],
    relationName: "sidechainSource"
  })
}))

export const midiSourcesRelations = relations(midiSources, ({ many }) => ({
  clips: many(midiClips)
}))

export const midiClipsRelations = relations(midiClips, ({ many, one }) => ({
  source: one(midiSources, {
    fields: [midiClips.sourceId],
    references: [midiSources.id]
  }),
  track: one(tracks, {
    fields: [midiClips.trackId],
    references: [tracks.id]
  }),
  notes: many(midiNotes),
  events: many(midiEvents)
}))

export const midiNotesRelations = relations(midiNotes, ({ one }) => ({
  clip: one(midiClips, {
    fields: [midiNotes.clipId],
    references: [midiClips.id]
  })
}))

export const midiEventsRelations = relations(midiEvents, ({ one }) => ({
  clip: one(midiClips, {
    fields: [midiEvents.clipId],
    references: [midiClips.id]
  })
}))

export type Project = typeof project.$inferSelect
export type Asset = typeof assets.$inferSelect
export type AssetWaveformLevel = typeof assetWaveformLevels.$inferSelect
export type MixerChannel = typeof mixerChannels.$inferSelect
export type Track = typeof tracks.$inferSelect
export type AudioClip = typeof audioClips.$inferSelect
export type MixerSend = typeof mixerSends.$inferSelect
export type PluginInstance = typeof pluginInstances.$inferSelect
export type PluginStateChunk = typeof pluginStateChunks.$inferSelect
export type PluginSidechainRoute = typeof pluginSidechainRoutes.$inferSelect
export type TempoEvent = typeof tempoEvents.$inferSelect
export type TimeSignatureEvent = typeof timeSignatureEvents.$inferSelect
export type KeySignatureEvent = typeof keySignatureEvents.$inferSelect
export type MidiSource = typeof midiSources.$inferSelect
export type MidiClip = typeof midiClips.$inferSelect
export type MidiNote = typeof midiNotes.$inferSelect
export type MidiEvent = typeof midiEvents.$inferSelect
