CREATE TABLE "live_patches" (
	"id" text PRIMARY KEY NOT NULL,
	"set_id" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer NOT NULL,
	"overrides" jsonb NOT NULL,
	CONSTRAINT "live_patches_id" CHECK (length(trim("live_patches"."id")) > 0),
	CONSTRAINT "live_patches_name" CHECK (length(trim("live_patches"."name")) > 0),
	CONSTRAINT "live_patches_sort_order_check" CHECK ("live_patches"."sort_order" >= 0),
	CONSTRAINT "live_patches_overrides" CHECK (jsonb_typeof("live_patches"."overrides") = 'array')
);
--> statement-breakpoint
CREATE TABLE "live_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer NOT NULL,
	"overrides" jsonb NOT NULL,
	CONSTRAINT "live_sets_id" CHECK (length(trim("live_sets"."id")) > 0),
	CONSTRAINT "live_sets_name" CHECK (length(trim("live_sets"."name")) > 0),
	CONSTRAINT "live_sets_sort_order_check" CHECK ("live_sets"."sort_order" >= 0),
	CONSTRAINT "live_sets_overrides" CHECK (jsonb_typeof("live_sets"."overrides") = 'array')
);
--> statement-breakpoint
ALTER TABLE "live_document" ALTER COLUMN "format_version" SET DEFAULT 2;--> statement-breakpoint
ALTER TABLE "live_patches" ADD CONSTRAINT "live_patches_set_id_live_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."live_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "live_patches_set_sort_order" ON "live_patches" USING btree ("set_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "live_sets_sort_order" ON "live_sets" USING btree ("sort_order");