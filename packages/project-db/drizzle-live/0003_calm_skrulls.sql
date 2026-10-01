CREATE TABLE "live_patch_plugin_state_chunks" (
	"patch_id" text NOT NULL,
	"plugin_id" text NOT NULL,
	"chunk_key" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	CONSTRAINT "live_patch_plugin_state_chunks_patch_id_plugin_id_chunk_key_pk" PRIMARY KEY("patch_id","plugin_id","chunk_key"),
	CONSTRAINT "live_patch_plugin_state_chunks_key" CHECK (length("live_patch_plugin_state_chunks"."chunk_key") > 0)
);
--> statement-breakpoint
CREATE TABLE "live_patch_plugin_states" (
	"patch_id" text NOT NULL,
	"plugin_id" text NOT NULL,
	CONSTRAINT "live_patch_plugin_states_patch_id_plugin_id_pk" PRIMARY KEY("patch_id","plugin_id")
);
--> statement-breakpoint
CREATE TABLE "live_set_plugin_state_chunks" (
	"set_id" text NOT NULL,
	"plugin_id" text NOT NULL,
	"chunk_key" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	CONSTRAINT "live_set_plugin_state_chunks_set_id_plugin_id_chunk_key_pk" PRIMARY KEY("set_id","plugin_id","chunk_key"),
	CONSTRAINT "live_set_plugin_state_chunks_key" CHECK (length("live_set_plugin_state_chunks"."chunk_key") > 0)
);
--> statement-breakpoint
CREATE TABLE "live_set_plugin_states" (
	"set_id" text NOT NULL,
	"plugin_id" text NOT NULL,
	CONSTRAINT "live_set_plugin_states_set_id_plugin_id_pk" PRIMARY KEY("set_id","plugin_id")
);
--> statement-breakpoint
ALTER TABLE "live_document" ALTER COLUMN "format_version" SET DEFAULT 3;--> statement-breakpoint
ALTER TABLE "live_patch_plugin_state_chunks" ADD CONSTRAINT "live_patch_plugin_state_chunks_patch_id_plugin_id_live_patch_plugin_states_patch_id_plugin_id_fk" FOREIGN KEY ("patch_id","plugin_id") REFERENCES "public"."live_patch_plugin_states"("patch_id","plugin_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_patch_plugin_states" ADD CONSTRAINT "live_patch_plugin_states_patch_id_live_patches_id_fk" FOREIGN KEY ("patch_id") REFERENCES "public"."live_patches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_patch_plugin_states" ADD CONSTRAINT "live_patch_plugin_states_plugin_id_plugin_instances_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugin_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_set_plugin_state_chunks" ADD CONSTRAINT "live_set_plugin_state_chunks_set_id_plugin_id_live_set_plugin_states_set_id_plugin_id_fk" FOREIGN KEY ("set_id","plugin_id") REFERENCES "public"."live_set_plugin_states"("set_id","plugin_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_set_plugin_states" ADD CONSTRAINT "live_set_plugin_states_set_id_live_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."live_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_set_plugin_states" ADD CONSTRAINT "live_set_plugin_states_plugin_id_plugin_instances_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugin_instances"("id") ON DELETE cascade ON UPDATE no action;