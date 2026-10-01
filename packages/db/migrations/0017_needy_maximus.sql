CREATE TABLE "site_screenshots" (
	"site_id" uuid PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"mime_type" text NOT NULL,
	"image" "bytea" NOT NULL,
	"captured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_screenshots" ADD CONSTRAINT "site_screenshots_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;