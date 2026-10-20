CREATE TABLE "track_freezes" (
	"track_id" text PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"status" text NOT NULL,
	"asset_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"start_frame" bigint NOT NULL,
	"length_frames" bigint NOT NULL,
	"latency_samples" integer NOT NULL,
	"tail_frames" bigint NOT NULL,
	"sample_rate" integer NOT NULL,
	CONSTRAINT "track_freezes_mode_check" CHECK ("track_freezes"."mode" in ('pre-fader', 'source-only')),
	CONSTRAINT "track_freezes_status_check" CHECK ("track_freezes"."status" in ('frozen', 'stale')),
	CONSTRAINT "track_freezes_fingerprint_check" CHECK (length("track_freezes"."fingerprint") > 0),
	CONSTRAINT "track_freezes_start_frame_check" CHECK ("track_freezes"."start_frame" >= 0),
	CONSTRAINT "track_freezes_length_frames_check" CHECK ("track_freezes"."length_frames" > 0),
	CONSTRAINT "track_freezes_latency_samples_check" CHECK ("track_freezes"."latency_samples" >= 0),
	CONSTRAINT "track_freezes_tail_frames_check" CHECK ("track_freezes"."tail_frames" >= 0),
	CONSTRAINT "track_freezes_sample_rate_check" CHECK ("track_freezes"."sample_rate" > 0)
);
--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "freeze_mode" text DEFAULT 'pre-fader' NOT NULL;--> statement-breakpoint
ALTER TABLE "track_freezes" ADD CONSTRAINT "track_freezes_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_freezes" ADD CONSTRAINT "track_freezes_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "track_freezes_asset_id_index" ON "track_freezes" USING btree ("asset_id");--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_freeze_mode_check" CHECK ("tracks"."freeze_mode" in ('pre-fader', 'source-only'));