ALTER TABLE "project" ADD COLUMN "kind" text DEFAULT 'studio' NOT NULL;
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "format_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_kind_check" CHECK ("kind" = 'studio');
--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_format_version_check" CHECK ("format_version" >= 1);
