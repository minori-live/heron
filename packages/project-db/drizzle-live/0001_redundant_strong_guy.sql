ALTER TABLE "mixer_channels" DROP CONSTRAINT "mixer_channels_system_role_check";--> statement-breakpoint
ALTER TABLE "mixer_channels" DROP CONSTRAINT "mixer_channels_system_role_kind_check";--> statement-breakpoint
ALTER TABLE "mixer_channels" DROP CONSTRAINT "mixer_channels_record_armed_check";--> statement-breakpoint
ALTER TABLE "mixer_channels" DROP CONSTRAINT "mixer_channels_input_monitoring_check";--> statement-breakpoint
ALTER TABLE "mixer_channels" DROP CONSTRAINT "mixer_channels_midi_input_check";--> statement-breakpoint
ALTER TABLE "mixer_channels" DROP CONSTRAINT "mixer_channels_output_route_check";--> statement-breakpoint
ALTER TABLE "mixer_channels" DROP CONSTRAINT "mixer_channels_input_check";--> statement-breakpoint
ALTER TABLE "mixer_channels" DROP CONSTRAINT "mixer_channels_input_channels_check";--> statement-breakpoint
ALTER TABLE "mixer_channels" DROP CONSTRAINT "mixer_channels_application_capture_check";--> statement-breakpoint
ALTER TABLE "mixer_channels" DROP CONSTRAINT "mixer_channels_hardware_output_check";--> statement-breakpoint
DROP INDEX "mixer_system_role_singleton";--> statement-breakpoint
ALTER TABLE "mixer_channels" DROP COLUMN "system_role";--> statement-breakpoint
ALTER TABLE "mixer_channels" DROP COLUMN "record_armed";--> statement-breakpoint
ALTER TABLE "mixer_channels" ADD CONSTRAINT "mixer_channels_input_monitoring_check" CHECK ("mixer_channels"."kind" in ('audio', 'aux', 'instrument') or not "mixer_channels"."input_monitoring");--> statement-breakpoint
ALTER TABLE "mixer_channels" ADD CONSTRAINT "mixer_channels_midi_input_check" CHECK ((
      "mixer_channels"."kind" = 'instrument'
      and (("mixer_channels"."midi_input_port_id" is null and "mixer_channels"."midi_input_port_name" is null)
        or ("mixer_channels"."midi_input_port_id" is not null and "mixer_channels"."midi_input_port_name" is not null))
      and ("mixer_channels"."midi_input_channel" is null or "mixer_channels"."midi_input_channel" between 0 and 15)
    ) or (
      "mixer_channels"."kind" <> 'instrument'
      and "mixer_channels"."midi_input_port_id" is null
      and "mixer_channels"."midi_input_port_name" is null
      and "mixer_channels"."midi_input_channel" is null
    ));--> statement-breakpoint
ALTER TABLE "mixer_channels" ADD CONSTRAINT "mixer_channels_output_route_check" CHECK ((
      "mixer_channels"."kind" in ('master', 'output')
      and "mixer_channels"."output_channel_id" is null and "mixer_channels"."output_bus" is null
    ) or (
      "mixer_channels"."kind" not in ('master', 'output')
      and num_nonnulls("mixer_channels"."output_channel_id", "mixer_channels"."output_bus") = 1
    ));--> statement-breakpoint
ALTER TABLE "mixer_channels" ADD CONSTRAINT "mixer_channels_input_check" CHECK ((
      "mixer_channels"."kind" in ('audio', 'aux')
      and "mixer_channels"."input_source" is not null and "mixer_channels"."input_format" is not null
      and (("mixer_channels"."input_format" = 'mono' and cardinality("mixer_channels"."input_channels") = 1)
        or ("mixer_channels"."input_format" = 'stereo' and cardinality("mixer_channels"."input_channels") = 2
          and "mixer_channels"."input_channels"[1] <> "mixer_channels"."input_channels"[2]))
    ) or (
      "mixer_channels"."kind" not in ('audio', 'aux')
      and "mixer_channels"."input_source" is null and "mixer_channels"."input_format" is null
      and cardinality("mixer_channels"."input_channels") = 0
    ));--> statement-breakpoint
ALTER TABLE "mixer_channels" ADD CONSTRAINT "mixer_channels_input_channels_check" CHECK ((
      "mixer_channels"."input_source" is null or (
        0 < all("mixer_channels"."input_channels")
        and (("mixer_channels"."input_source" = 'hardware' and 32 >= all("mixer_channels"."input_channels"))
          or ("mixer_channels"."input_source" = 'bus' and 256 >= all("mixer_channels"."input_channels"))
          or ("mixer_channels"."input_source" = 'application' and 2 >= all("mixer_channels"."input_channels")))
      )
    ));--> statement-breakpoint
ALTER TABLE "mixer_channels" ADD CONSTRAINT "mixer_channels_application_capture_check" CHECK ((
      ("mixer_channels"."input_source" = 'application' and "mixer_channels"."application_capture" is not null)
      or ("mixer_channels"."input_source" <> 'application' and "mixer_channels"."application_capture" is null)
      or ("mixer_channels"."input_source" is null and "mixer_channels"."application_capture" is null)
    ));--> statement-breakpoint
ALTER TABLE "mixer_channels" ADD CONSTRAINT "mixer_channels_hardware_output_check" CHECK ((
      "mixer_channels"."kind" = 'output'
      and cardinality("mixer_channels"."hardware_output_channels") = 2
      and "mixer_channels"."hardware_output_channels"[1] <> "mixer_channels"."hardware_output_channels"[2]
      and 0 < all("mixer_channels"."hardware_output_channels")
    ) or (
      "mixer_channels"."kind" <> 'output' and cardinality("mixer_channels"."hardware_output_channels") = 0
    ));