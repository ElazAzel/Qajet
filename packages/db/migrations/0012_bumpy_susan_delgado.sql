ALTER TABLE "plan_lines" ADD COLUMN "commission_pct" real DEFAULT 23 NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_lines" ADD COLUMN "commission_kzt" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE POLICY "plan_lines_update_staff" ON "plan_lines" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_role()) in ('concierge', 'admin')) WITH CHECK ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
-- Бэкфилл существующих строк (комиссия по позиции — новое понятие,
-- раньше существовала только агрегатом на plans): те же 23%, что и
-- новый DEFAULT колонки, применённые к уже записанной цене поставщика.
-- Явно, не полагаясь на DEFAULT молча — если он когда-нибудь изменится,
-- эта историчная строка не должна тихо переехать вместе с ним.
UPDATE "plan_lines" SET "commission_pct" = 23, "commission_kzt" = round("line_total_kzt" * 23 / 100.0);