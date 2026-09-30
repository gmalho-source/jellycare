CREATE TYPE "public"."report_request_scope" AS ENUM('last_month', 'month_to_date');--> statement-breakpoint
ALTER TABLE "report_requests" ADD COLUMN "scope" "report_request_scope" DEFAULT 'last_month' NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "partial" boolean DEFAULT false NOT NULL;