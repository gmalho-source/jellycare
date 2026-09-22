CREATE TYPE "public"."legal_document_kind" AS ENUM('dpa', 'subprocessors', 'terms');--> statement-breakpoint
CREATE TYPE "public"."legal_locale" AS ENUM('pt', 'en');--> statement-breakpoint
CREATE TABLE "legal_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"represented_by" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "legal_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "legal_document_kind" NOT NULL,
	"locale" "legal_locale" NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"content_hash" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_objections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "negotiated_dpa_ref" text;--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_document_id_legal_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."legal_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_objections" ADD CONSTRAINT "legal_objections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_objections" ADD CONSTRAINT "legal_objections_document_id_legal_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."legal_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_objections" ADD CONSTRAINT "legal_objections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "legal_acceptances_org_document_idx" ON "legal_acceptances" USING btree ("organization_id","document_id");--> statement-breakpoint
CREATE INDEX "legal_acceptances_org_idx" ON "legal_acceptances" USING btree ("organization_id","accepted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_documents_kind_locale_version_idx" ON "legal_documents" USING btree ("kind","locale","version");--> statement-breakpoint
CREATE INDEX "legal_documents_kind_idx" ON "legal_documents" USING btree ("kind","effective_at");--> statement-breakpoint
CREATE INDEX "legal_objections_org_idx" ON "legal_objections" USING btree ("organization_id","created_at");