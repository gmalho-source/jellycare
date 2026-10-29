CREATE TABLE "claude_resolve_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"finding_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"repo" text NOT NULL,
	"issue_number" integer,
	"issue_url" text,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "github_repo" text;--> statement-breakpoint
ALTER TABLE "claude_resolve_requests" ADD CONSTRAINT "claude_resolve_requests_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_resolve_requests" ADD CONSTRAINT "claude_resolve_requests_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_resolve_requests" ADD CONSTRAINT "claude_resolve_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "claude_resolve_requests_finding_idx" ON "claude_resolve_requests" USING btree ("finding_id");