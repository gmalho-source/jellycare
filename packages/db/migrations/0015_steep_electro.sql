CREATE TYPE "public"."report_note_mode" AS ENUM('persistent', 'next_only');--> statement-breakpoint
CREATE TABLE "report_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"body" text NOT NULL,
	"mode" "report_note_mode" NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"report_id" uuid,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "report_excluded_sections" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "report_notes" ADD CONSTRAINT "report_notes_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_notes" ADD CONSTRAINT "report_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_notes" ADD CONSTRAINT "report_notes_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_notes_site_idx" ON "report_notes" USING btree ("site_id","created_at");