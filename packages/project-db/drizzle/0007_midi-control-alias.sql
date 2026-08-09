ALTER TABLE "plugin_instances" ADD COLUMN "control_alias" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "plugin_instances_control_alias_unique"
  ON "plugin_instances" USING btree ("control_alias")
  WHERE "plugin_instances"."control_alias" is not null;
--> statement-breakpoint
ALTER TABLE "plugin_instances"
  ADD CONSTRAINT "plugin_instances_control_alias_check"
  CHECK (
    "control_alias" is null or (
      octet_length("control_alias") between 1 and 64
      and "control_alias" ~ '^[a-z0-9][a-z0-9._-]*$'
    )
  );
