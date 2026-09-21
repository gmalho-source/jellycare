CREATE TYPE "public"."check_status" AS ENUM('ok', 'failed');--> statement-breakpoint
CREATE TYPE "public"."finding_state" AS ENUM('pending', 'open', 'acknowledged', 'resolved', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'member', 'client');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('email', 'slack', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('info', 'low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."site_state" AS ENUM('onboarding', 'active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."verification_method" AS ENUM('dns_txt', 'http_file');--> statement-breakpoint
CREATE TYPE "public"."verification_state" AS ENUM('pending', 'verified', 'failed');--> statement-breakpoint
CREATE TABLE "check_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"check_type" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"interval_minutes" integer NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "check_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"check_type" text NOT NULL,
	"status" "check_status" NOT NULL,
	"region" text DEFAULT 'eu-west' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"error" text,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"check_type" text NOT NULL,
	"fingerprint" text NOT NULL,
	"code" text NOT NULL,
	"discriminator" text,
	"severity" "severity" NOT NULL,
	"state" "finding_state" DEFAULT 'pending' NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"evidence" jsonb,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"acknowledged_by" uuid,
	"acknowledged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "form_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"canary_token" text NOT NULL,
	"canary_address" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"submitted" boolean DEFAULT false NOT NULL,
	"submit_error" text,
	"email_received" boolean DEFAULT false NOT NULL,
	"email_received_at" timestamp with time zone,
	"delivery_latency_ms" integer,
	"spf" text,
	"dkim" text,
	"dmarc" text,
	"landed_in_spam" boolean,
	"screenshot_key" text,
	CONSTRAINT "form_runs_canary_token_unique" UNIQUE("canary_token")
);
--> statement-breakpoint
CREATE TABLE "forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"label" text NOT NULL,
	"page_url" text NOT NULL,
	"selector" text NOT NULL,
	"field_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"success_indicator" text,
	"expected_recipient" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"excluded" boolean DEFAULT false NOT NULL,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid NOT NULL,
	"finding_id" uuid,
	"kind" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"succeeded" boolean NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "notification_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid,
	"channel" "notification_channel" NOT NULL,
	"destination" text NOT NULL,
	"min_severity" "severity" DEFAULT 'high' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "site_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"method" "verification_method" NOT NULL,
	"token" text NOT NULL,
	"state" "verification_state" DEFAULT 'pending' NOT NULL,
	"verified_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"label" text NOT NULL,
	"url" text NOT NULL,
	"hostname" text NOT NULL,
	"state" "site_state" DEFAULT 'onboarding' NOT NULL,
	"platform" text,
	"expected_content" text,
	"maintenance_windows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uptime_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"region" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"up" boolean NOT NULL,
	"status_code" integer,
	"response_time_ms" real,
	"failure_reason" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "check_configs" ADD CONSTRAINT "check_configs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_runs" ADD CONSTRAINT "check_runs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_runs" ADD CONSTRAINT "form_runs_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_runs" ADD CONSTRAINT "form_runs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_target_id_notification_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."notification_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_targets" ADD CONSTRAINT "notification_targets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_targets" ADD CONSTRAINT "notification_targets_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_verifications" ADD CONSTRAINT "site_verifications_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_samples" ADD CONSTRAINT "uptime_samples_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "check_configs_site_type_idx" ON "check_configs" USING btree ("site_id","check_type");--> statement-breakpoint
CREATE INDEX "check_configs_due_idx" ON "check_configs" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "check_runs_site_type_idx" ON "check_runs" USING btree ("site_id","check_type","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "findings_site_fingerprint_idx" ON "findings" USING btree ("site_id","fingerprint");--> statement-breakpoint
CREATE INDEX "findings_site_state_idx" ON "findings" USING btree ("site_id","state","severity");--> statement-breakpoint
CREATE INDEX "findings_open_idx" ON "findings" USING btree ("state","last_seen_at");--> statement-breakpoint
CREATE INDEX "form_runs_form_idx" ON "form_runs" USING btree ("form_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "forms_site_page_selector_idx" ON "forms" USING btree ("site_id","page_url","selector");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user_idx" ON "memberships" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_finding_idx" ON "notification_deliveries" USING btree ("finding_id","sent_at");--> statement-breakpoint
CREATE INDEX "notification_targets_org_idx" ON "notification_targets" USING btree ("organization_id","site_id");--> statement-breakpoint
CREATE INDEX "site_verifications_site_idx" ON "site_verifications" USING btree ("site_id","state");--> statement-breakpoint
CREATE INDEX "sites_org_idx" ON "sites" USING btree ("organization_id","state");--> statement-breakpoint
CREATE INDEX "uptime_samples_site_idx" ON "uptime_samples" USING btree ("site_id","observed_at");