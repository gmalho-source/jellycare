CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"period_year" integer NOT NULL,
	"period_month" integer NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pdf" "bytea" NOT NULL,
	"file_name" text NOT NULL,
	"highlights" jsonb NOT NULL,
	"sent_at" timestamp with time zone,
	"sent_to" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"send_error" text
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "report_send_day" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "brand_name" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "brand_url" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "sla_target" real DEFAULT 99.9 NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "report_recipients" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reports_site_period_idx" ON "reports" USING btree ("site_id","period_year","period_month");--> statement-breakpoint
CREATE INDEX "reports_site_idx" ON "reports" USING btree ("site_id","generated_at");