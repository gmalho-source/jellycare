CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"finding_id" uuid,
	"kind" text NOT NULL,
	"actor_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_events_site_idx" ON "activity_events" USING btree ("site_id","occurred_at");--> statement-breakpoint
CREATE INDEX "activity_events_occurred_idx" ON "activity_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "activity_events_finding_idx" ON "activity_events" USING btree ("finding_id");--> statement-breakpoint
-- Preencher o passado com o que já estava guardado. As reincidências antigas e
-- quem silenciou antes da última vez perderam-se: não estavam em lado nenhum.
INSERT INTO "activity_events" ("site_id", "finding_id", "kind", "data", "occurred_at")
SELECT "site_id", "id", 'problema_detetado',
       jsonb_build_object('titulo', "title", 'codigo', "code", 'severidade', "severity"),
       "first_seen_at"
FROM "findings" WHERE "state" <> 'pending';--> statement-breakpoint
INSERT INTO "activity_events" ("site_id", "finding_id", "kind", "data", "occurred_at")
SELECT "site_id", "id", 'problema_resolvido',
       jsonb_build_object('titulo', "title", 'codigo', "code", 'severidade', "severity"),
       "resolved_at"
FROM "findings" WHERE "state" = 'resolved' AND "resolved_at" IS NOT NULL;--> statement-breakpoint
INSERT INTO "activity_events" ("site_id", "finding_id", "kind", "actor_id", "data", "occurred_at")
SELECT "site_id", "id",
       CASE WHEN "state" = 'ignored' THEN 'problema_silenciado' ELSE 'problema_reconhecido' END,
       "acknowledged_by",
       jsonb_build_object('titulo', "title", 'codigo', "code", 'severidade', "severity"),
       "acknowledged_at"
FROM "findings" WHERE "state" IN ('acknowledged', 'ignored') AND "acknowledged_at" IS NOT NULL;--> statement-breakpoint
INSERT INTO "activity_events" ("site_id", "finding_id", "kind", "actor_id", "data", "occurred_at")
SELECT r."site_id", r."finding_id", 'claude_resolve_pedido', r."requested_by",
       jsonb_build_object('titulo', f."title", 'codigo', f."code", 'severidade', f."severity",
         'issue', jsonb_build_object('numero', r."issue_number", 'url', r."issue_url", 'repositorio', r."repo")),
       r."created_at"
FROM "claude_resolve_requests" r JOIN "findings" f ON f."id" = r."finding_id"
WHERE r."issue_number" IS NOT NULL;--> statement-breakpoint
INSERT INTO "activity_events" ("site_id", "finding_id", "kind", "actor_id", "data", "occurred_at")
SELECT f."site_id", n."finding_id", 'aviso_ao_cliente', n."sent_by",
       jsonb_build_object('titulo', f."title", 'codigo', f."code", 'assunto', n."subject",
         'destinatarios', jsonb_array_length(n."recipients")),
       n."sent_at"
FROM "client_notifications" n JOIN "findings" f ON f."id" = n."finding_id"
WHERE n."sent_at" IS NOT NULL;--> statement-breakpoint
INSERT INTO "activity_events" ("site_id", "kind", "data", "occurred_at")
SELECT "site_id",
       CASE WHEN "status" = 'succeeded' THEN 'wp_atualizado' ELSE 'wp_atualizacao_falhou' END,
       jsonb_strip_nulls(jsonb_build_object(
         'componente', jsonb_build_object('tipo', "kind", 'nome', "name", 'de', "from_version",
           'para', "to_version", 'vulneravel', "vulnerable"),
         'erro', "error")),
       coalesce("settled_at", "ordered_at")
FROM "wp_updates" WHERE "status" IN ('succeeded', 'failed');
