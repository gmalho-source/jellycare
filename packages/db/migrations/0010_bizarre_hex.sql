CREATE TABLE "wp_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"from_version" text,
	"to_version" text,
	"vulnerable" boolean DEFAULT false NOT NULL,
	"process_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"ordered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "auto_update" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "wp_updates" ADD CONSTRAINT "wp_updates_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wp_updates_site_idx" ON "wp_updates" USING btree ("site_id","ordered_at");--> statement-breakpoint
CREATE INDEX "wp_updates_process_idx" ON "wp_updates" USING btree ("process_id");