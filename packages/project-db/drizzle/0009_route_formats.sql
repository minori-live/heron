ALTER TABLE "mixer_channels" DROP CONSTRAINT "mixer_channels_output_bus_check";--> statement-breakpoint
ALTER TABLE "mixer_sends" DROP CONSTRAINT "mixer_sends_target_check";--> statement-breakpoint
DROP INDEX "mixer_sends_source_bus_unique";--> statement-breakpoint
DROP INDEX "mixer_sends_source_output_unique";--> statement-breakpoint
ALTER TABLE "mixer_channels" ADD COLUMN "output_format" text;--> statement-breakpoint
ALTER TABLE "mixer_sends" ADD COLUMN "target_format" text;--> statement-breakpoint
CREATE UNIQUE INDEX "mixer_sends_source_bus_unique" ON "mixer_sends" USING btree ("source_channel_id","target_bus",coalesce("target_format", 'mono')) WHERE "mixer_sends"."target_bus" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "mixer_sends_source_output_unique" ON "mixer_sends" USING btree ("source_channel_id","target_channel_id",coalesce("target_format", 'stereo')) WHERE "mixer_sends"."target_channel_id" is not null;--> statement-breakpoint
ALTER TABLE "mixer_channels" ADD CONSTRAINT "mixer_channels_output_format_check" CHECK ("mixer_channels"."output_format" is null or "mixer_channels"."output_format" in ('mono', 'stereo'));--> statement-breakpoint
ALTER TABLE "mixer_channels" ADD CONSTRAINT "mixer_channels_output_bus_check" CHECK ("mixer_channels"."output_bus" is null or "mixer_channels"."output_bus" between 1 and (case when "mixer_channels"."output_format" = 'stereo' then 255 else 256 end));--> statement-breakpoint
ALTER TABLE "mixer_sends" ADD CONSTRAINT "mixer_sends_target_format_check" CHECK ("mixer_sends"."target_format" is null or "mixer_sends"."target_format" in ('mono', 'stereo'));--> statement-breakpoint
ALTER TABLE "mixer_sends" ADD CONSTRAINT "mixer_sends_target_check" CHECK (num_nonnulls("mixer_sends"."target_channel_id", "mixer_sends"."target_bus") = 1
        and ("mixer_sends"."target_bus" is null or "mixer_sends"."target_bus" between 1 and (case when "mixer_sends"."target_format" = 'stereo' then 255 else 256 end)));