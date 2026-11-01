ALTER TABLE "reports" ADD COLUMN "recipients_override" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Os relatórios já gerados por um pedido no painel com endereços escolhidos à
-- mão. É o pedido mais recente para esse site e período que ficou com o
-- relatório: concluído depois de ele ser gerado.
UPDATE "reports" r SET "recipients_override" = true
WHERE EXISTS (
  SELECT 1 FROM "report_requests" q
  WHERE q."site_id" = r."site_id"
    AND q."period_year" = r."period_year"
    AND q."period_month" = r."period_month"
    AND jsonb_array_length(q."recipients") > 0
    AND q."completed_at" >= r."generated_at"
);
