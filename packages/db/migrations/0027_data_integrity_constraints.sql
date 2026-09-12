DROP INDEX "estimates_request_id_idx";--> statement-breakpoint
DROP INDEX "prepayments_request_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "estimates_request_id_idx" ON "estimates" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prepayments_request_id_idx" ON "prepayments" USING btree ("request_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_approval_limit_nonnegative" CHECK ("users"."approval_limit_kzt" is null or "users"."approval_limit_kzt" >= 0);--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_amounts_nonnegative" CHECK ("estimates"."p50_kzt" >= 0 and "estimates"."p80_kzt" >= 0);--> statement-breakpoint
ALTER TABLE "plan_lines" ADD CONSTRAINT "plan_lines_qty_positive" CHECK ("plan_lines"."qty" > 0);--> statement-breakpoint
ALTER TABLE "prepayments" ADD CONSTRAINT "prepayments_amount_nonnegative" CHECK ("prepayments"."amount_kzt" >= 0);--> statement-breakpoint
ALTER TABLE "request_items" ADD CONSTRAINT "request_items_qty_positive" CHECK ("request_items"."qty" > 0);--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_budget_nonnegative" CHECK ("requests"."budget_kzt" is null or "requests"."budget_kzt" >= 0);--> statement-breakpoint
ALTER TABLE "supplier_payouts" ADD CONSTRAINT "supplier_payouts_amount_nonnegative" CHECK ("supplier_payouts"."amount_kzt" >= 0);