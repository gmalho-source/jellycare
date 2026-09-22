CREATE TABLE "wp_backups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"trigger_type" text,
	"wordpress_version" text,
	"size_bytes" integer,
	"error_code" text
);
--> statement-breakpoint
ALTER TABLE "wp_backups" ADD CONSTRAINT "wp_backups_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wp_backups_site_external_idx" ON "wp_backups" USING btree ("site_id","external_id");--> statement-breakpoint
CREATE INDEX "wp_backups_site_idx" ON "wp_backups" USING btree ("site_id","started_at");