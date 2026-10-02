CREATE TABLE "organization_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"job_title" text,
	"phone" text,
	"email" text,
	"receives_reports" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_contacts_reports_need_email" CHECK (not "organization_contacts"."receives_reports" or "organization_contacts"."email" is not null)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_staff" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_contacts" ADD CONSTRAINT "organization_contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_contacts_org_idx" ON "organization_contacts" USING btree ("organization_id");--> statement-breakpoint
-- Quem hoje é dono de uma organização entra na Equipa Jelly. Só a semente
-- inicial cria donos (o painel não concede esse papel), por isso é a equipa
-- que montou a plataforma, e é por aí que a página Equipa fica acessível.
UPDATE "users" SET "is_staff" = true WHERE "id" IN (SELECT "user_id" FROM "memberships" WHERE "role" = 'owner');
