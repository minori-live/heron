CREATE TABLE "live_document" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'live' NOT NULL,
	"format_version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"sample_rate" integer NOT NULL,
	"backend" text,
	"input_device_id" text,
	"output_device_id" text,
	"buffer_size" integer,
	"enabled_midi_device_ids" text[] DEFAULT array[]::text[] NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "live_document_singleton" CHECK ("live_document"."id" = 'document'),
	CONSTRAINT "live_document_kind" CHECK ("live_document"."kind" = 'live'),
	CONSTRAINT "live_document_version" CHECK ("live_document"."format_version" >= 1),
	CONSTRAINT "live_document_name" CHECK (length(trim("live_document"."name")) > 0),
	CONSTRAINT "live_document_sample_rate" CHECK ("live_document"."sample_rate" in (44100, 48000, 88200, 96000, 176400, 192000)),
	CONSTRAINT "live_document_buffer" CHECK ("live_document"."buffer_size" is null or "live_document"."buffer_size" between 16 and 16384),
	CONSTRAINT "live_document_revision" CHECK ("live_document"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "live_midi_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"port_id" text NOT NULL,
	"channel" smallint NOT NULL,
	"message_kind" text NOT NULL,
	"number" smallint NOT NULL,
	"input_mode" jsonb NOT NULL,
	"target" jsonb NOT NULL,
	"transform_profile_id" text,
	CONSTRAINT "live_midi_binding_channel" CHECK ("live_midi_bindings"."channel" between 0 and 15),
	CONSTRAINT "live_midi_binding_number" CHECK ("live_midi_bindings"."number" between 0 and 127),
	CONSTRAINT "live_midi_binding_kind" CHECK ("live_midi_bindings"."message_kind" in ('note', 'control-change')),
	CONSTRAINT "live_midi_binding_port" CHECK (length(trim("live_midi_bindings"."port_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE "live_plugin_parameter_values" (
	"plugin_id" text NOT NULL,
	"parameter_key" text NOT NULL,
	"value" double precision NOT NULL,
	CONSTRAINT "live_plugin_parameter_values_plugin_id_parameter_key_pk" PRIMARY KEY("plugin_id","parameter_key"),
	CONSTRAINT "live_plugin_parameter_key" CHECK (length(trim("live_plugin_parameter_values"."parameter_key")) > 0)
);
--> statement-breakpoint
CREATE TABLE "mixer_channels" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"system_role" text,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"sort_order" integer NOT NULL,
	"input_source" text,
	"input_format" text,
	"application_capture" jsonb,
	"midi_input_port_id" text,
	"midi_input_port_name" text,
	"midi_input_channel" smallint,
	"gain_db" double precision DEFAULT 0 NOT NULL,
	"pan" double precision DEFAULT 0 NOT NULL,
	"muted" boolean DEFAULT false NOT NULL,
	"soloed" boolean DEFAULT false NOT NULL,
	"output_channel_id" text,
	"output_bus" smallint,
	"record_armed" boolean DEFAULT false NOT NULL,
	"input_monitoring" boolean DEFAULT false NOT NULL,
	"input_channels" smallint[] DEFAULT array[]::smallint[] NOT NULL,
	"hardware_output_channels" smallint[] DEFAULT array[]::smallint[] NOT NULL,
	CONSTRAINT "mixer_channels_kind_check" CHECK ("mixer_channels"."kind" in ('audio', 'instrument', 'aux', 'master', 'output')),
	CONSTRAINT "mixer_channels_system_role_check" CHECK ("mixer_channels"."system_role" is null or "mixer_channels"."system_role" = 'metronome'),
	CONSTRAINT "mixer_channels_system_role_kind_check" CHECK ("mixer_channels"."system_role" is null or "mixer_channels"."kind" = 'instrument'),
	CONSTRAINT "mixer_channels_name_check" CHECK (length(trim("mixer_channels"."name")) > 0),
	CONSTRAINT "mixer_channels_color_check" CHECK ("mixer_channels"."color" ~ '^#[0-9A-Fa-f]{6}$'),
	CONSTRAINT "mixer_channels_sort_order_check" CHECK ("mixer_channels"."sort_order" >= 0),
	CONSTRAINT "mixer_channels_gain_db_check" CHECK ("mixer_channels"."gain_db" between -90 and 12),
	CONSTRAINT "mixer_channels_pan_check" CHECK ("mixer_channels"."pan" between -1 and 1),
	CONSTRAINT "mixer_channels_master_solo_check" CHECK ("mixer_channels"."kind" <> 'master' or not "mixer_channels"."soloed"),
	CONSTRAINT "mixer_channels_input_monitoring_check" CHECK (("mixer_channels"."kind" in ('audio', 'aux') or ("mixer_channels"."kind" = 'instrument' and "mixer_channels"."system_role" is null))
        or not "mixer_channels"."input_monitoring"),
	CONSTRAINT "mixer_channels_record_armed_check" CHECK (("mixer_channels"."kind" = 'audio' or ("mixer_channels"."kind" = 'instrument' and "mixer_channels"."system_role" is null))
        or not "mixer_channels"."record_armed"),
	CONSTRAINT "mixer_channels_midi_input_check" CHECK ((
        "mixer_channels"."kind" = 'instrument'
        and "mixer_channels"."system_role" is null
        and (
          ("mixer_channels"."midi_input_port_id" is null and "mixer_channels"."midi_input_port_name" is null)
          or ("mixer_channels"."midi_input_port_id" is not null and "mixer_channels"."midi_input_port_name" is not null)
        )
        and ("mixer_channels"."midi_input_channel" is null or "mixer_channels"."midi_input_channel" between 0 and 15)
      ) or (
        not ("mixer_channels"."kind" = 'instrument' and "mixer_channels"."system_role" is null)
        and "mixer_channels"."midi_input_port_id" is null
        and "mixer_channels"."midi_input_port_name" is null
        and "mixer_channels"."midi_input_channel" is null
      )),
	CONSTRAINT "mixer_channels_output_route_check" CHECK ((
        "mixer_channels"."kind" in ('master', 'output')
        and "mixer_channels"."output_channel_id" is null
        and "mixer_channels"."output_bus" is null
      ) or (
        "mixer_channels"."kind" not in ('master', 'output')
        and num_nonnulls("mixer_channels"."output_channel_id", "mixer_channels"."output_bus") = 1
      )),
	CONSTRAINT "mixer_channels_output_bus_check" CHECK ("mixer_channels"."output_bus" is null or "mixer_channels"."output_bus" between 1 and 256),
	CONSTRAINT "mixer_channels_input_check" CHECK ((
      "mixer_channels"."kind" in ('audio', 'aux')
      and "mixer_channels"."input_source" is not null
      and "mixer_channels"."input_format" is not null
      and (
        ("mixer_channels"."input_format" = 'mono' and cardinality("mixer_channels"."input_channels") = 1)
        or (
          "mixer_channels"."input_format" = 'stereo'
          and cardinality("mixer_channels"."input_channels") = 2
          and "mixer_channels"."input_channels"[1] <> "mixer_channels"."input_channels"[2]
        )
      )
    ) or (
      "mixer_channels"."kind" not in ('audio', 'aux')
      and "mixer_channels"."input_source" is null
      and "mixer_channels"."input_format" is null
      and cardinality("mixer_channels"."input_channels") = 0
    )),
	CONSTRAINT "mixer_channels_input_channels_check" CHECK ((
        "mixer_channels"."input_source" is null
        or (
          0 < all("mixer_channels"."input_channels")
          and (
            ("mixer_channels"."input_source" = 'hardware' and 32 >= all("mixer_channels"."input_channels"))
            or ("mixer_channels"."input_source" = 'bus' and 256 >= all("mixer_channels"."input_channels"))
            or ("mixer_channels"."input_source" = 'application' and 2 >= all("mixer_channels"."input_channels"))
          )
        )
      )),
	CONSTRAINT "mixer_channels_application_capture_check" CHECK ((
        ("mixer_channels"."input_source" = 'application' and "mixer_channels"."application_capture" is not null)
        or ("mixer_channels"."input_source" <> 'application' and "mixer_channels"."application_capture" is null)
        or ("mixer_channels"."input_source" is null and "mixer_channels"."application_capture" is null)
      )),
	CONSTRAINT "mixer_channels_hardware_output_check" CHECK ((
      "mixer_channels"."kind" = 'output'
      and cardinality("mixer_channels"."hardware_output_channels") = 2
      and "mixer_channels"."hardware_output_channels"[1] <> "mixer_channels"."hardware_output_channels"[2]
      and 0 < all("mixer_channels"."hardware_output_channels")
    ) or (
      "mixer_channels"."kind" <> 'output'
      and cardinality("mixer_channels"."hardware_output_channels") = 0
    ))
);
--> statement-breakpoint
CREATE TABLE "mixer_sends" (
	"id" text PRIMARY KEY NOT NULL,
	"source_channel_id" text NOT NULL,
	"target_channel_id" text,
	"target_bus" smallint,
	"sort_order" integer NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"tap" text DEFAULT 'post-pan' NOT NULL,
	"level_db" double precision DEFAULT -90 NOT NULL,
	CONSTRAINT "mixer_sends_sort_order_check" CHECK ("mixer_sends"."sort_order" >= 0),
	CONSTRAINT "mixer_sends_tap_check" CHECK ("mixer_sends"."tap" in ('pre', 'post', 'post-pan')),
	CONSTRAINT "mixer_sends_level_db_check" CHECK ("mixer_sends"."level_db" between -90 and 12),
	CONSTRAINT "mixer_sends_target_check" CHECK (num_nonnulls("mixer_sends"."target_channel_id", "mixer_sends"."target_bus") = 1
        and ("mixer_sends"."target_bus" is null or "mixer_sends"."target_bus" between 1 and 256))
);
--> statement-breakpoint
CREATE TABLE "plugin_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"role" text NOT NULL,
	"slot_order" integer NOT NULL,
	"locator_format" text NOT NULL,
	"artifact_path" text NOT NULL,
	"native_id" text NOT NULL,
	"descriptor_snapshot" text NOT NULL,
	"audio_mode" text DEFAULT 'stereo' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"control_alias" text,
	CONSTRAINT "plugin_instances_role_check" CHECK ("plugin_instances"."role" in ('instrument', 'insert')),
	CONSTRAINT "plugin_instances_format_check" CHECK ("plugin_instances"."locator_format" in ('vst3', 'clap')),
	CONSTRAINT "plugin_instances_audio_mode_check" CHECK ("plugin_instances"."audio_mode" in ('mono', 'mono-to-stereo', 'stereo', 'dual-mono')),
	CONSTRAINT "plugin_instances_slot_order_check" CHECK ("plugin_instances"."slot_order" >= 0),
	CONSTRAINT "plugin_instances_control_alias_check" CHECK ("plugin_instances"."control_alias" is null or (
        octet_length("plugin_instances"."control_alias") between 1 and 64
        and "plugin_instances"."control_alias" ~ '^[a-z0-9][a-z0-9._-]*$'
      )),
	CONSTRAINT "plugin_instances_instrument_slot_check" CHECK ("plugin_instances"."role" <> 'instrument' or "plugin_instances"."slot_order" = 0)
);
--> statement-breakpoint
CREATE TABLE "plugin_sidechain_routes" (
	"plugin_id" text NOT NULL,
	"input_port_key" text NOT NULL,
	"source_channel_id" text NOT NULL,
	CONSTRAINT "plugin_sidechain_routes_plugin_id_input_port_key_pk" PRIMARY KEY("plugin_id","input_port_key"),
	CONSTRAINT "plugin_sidechain_routes_port_key_check" CHECK (length("plugin_sidechain_routes"."input_port_key") > 0)
);
--> statement-breakpoint
CREATE TABLE "plugin_state_chunks" (
	"plugin_id" text NOT NULL,
	"chunk_key" text NOT NULL,
	"bytes" "bytea" DEFAULT ''::bytea NOT NULL,
	CONSTRAINT "plugin_state_chunks_plugin_id_chunk_key_pk" PRIMARY KEY("plugin_id","chunk_key"),
	CONSTRAINT "plugin_state_chunks_key_check" CHECK (length("plugin_state_chunks"."chunk_key") > 0)
);
--> statement-breakpoint
ALTER TABLE "live_plugin_parameter_values" ADD CONSTRAINT "live_plugin_parameter_values_plugin_id_plugin_instances_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugin_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mixer_channels" ADD CONSTRAINT "mixer_channels_output_channel_id_fk" FOREIGN KEY ("output_channel_id") REFERENCES "public"."mixer_channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mixer_sends" ADD CONSTRAINT "mixer_sends_source_channel_id_mixer_channels_id_fk" FOREIGN KEY ("source_channel_id") REFERENCES "public"."mixer_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mixer_sends" ADD CONSTRAINT "mixer_sends_target_channel_id_mixer_channels_id_fk" FOREIGN KEY ("target_channel_id") REFERENCES "public"."mixer_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_instances" ADD CONSTRAINT "plugin_instances_channel_id_mixer_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."mixer_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_sidechain_routes" ADD CONSTRAINT "plugin_sidechain_routes_plugin_id_plugin_instances_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugin_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_sidechain_routes" ADD CONSTRAINT "plugin_sidechain_routes_source_channel_id_mixer_channels_id_fk" FOREIGN KEY ("source_channel_id") REFERENCES "public"."mixer_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_state_chunks" ADD CONSTRAINT "plugin_state_chunks_plugin_id_plugin_instances_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugin_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "live_midi_binding_address" ON "live_midi_bindings" USING btree ("port_id","channel","message_kind","number");--> statement-breakpoint
CREATE UNIQUE INDEX "mixer_master_singleton" ON "mixer_channels" USING btree ("kind") WHERE "mixer_channels"."kind" = 'master';--> statement-breakpoint
CREATE UNIQUE INDEX "mixer_output_channels_unique" ON "mixer_channels" USING btree ("hardware_output_channels") WHERE "mixer_channels"."kind" = 'output';--> statement-breakpoint
CREATE UNIQUE INDEX "mixer_system_role_singleton" ON "mixer_channels" USING btree ("system_role") WHERE "mixer_channels"."system_role" is not null;--> statement-breakpoint
CREATE INDEX "mixer_channel_sort_order" ON "mixer_channels" USING btree ("kind","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "mixer_sends_source_bus_unique" ON "mixer_sends" USING btree ("source_channel_id","target_bus") WHERE "mixer_sends"."target_bus" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "mixer_sends_source_output_unique" ON "mixer_sends" USING btree ("source_channel_id","target_channel_id") WHERE "mixer_sends"."target_channel_id" is not null;--> statement-breakpoint
CREATE INDEX "mixer_sends_source_order" ON "mixer_sends" USING btree ("source_channel_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "plugin_instances_channel_role_slot_unique" ON "plugin_instances" USING btree ("channel_id","role","slot_order");--> statement-breakpoint
CREATE UNIQUE INDEX "plugin_instances_instrument_singleton" ON "plugin_instances" USING btree ("channel_id") WHERE "plugin_instances"."role" = 'instrument';--> statement-breakpoint
CREATE UNIQUE INDEX "plugin_instances_control_alias_unique" ON "plugin_instances" USING btree ("control_alias") WHERE "plugin_instances"."control_alias" is not null;--> statement-breakpoint
CREATE INDEX "plugin_instances_channel_order" ON "plugin_instances" USING btree ("channel_id","role","slot_order");--> statement-breakpoint
CREATE INDEX "plugin_sidechain_routes_source_channel" ON "plugin_sidechain_routes" USING btree ("source_channel_id");