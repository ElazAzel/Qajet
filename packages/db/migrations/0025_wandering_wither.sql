CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"kind" text NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outbox" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE INDEX "outbox_status_available_at_idx" ON "outbox" USING btree ("status", "available_at");
--> statement-breakpoint
CREATE INDEX "outbox_created_at_idx" ON "outbox" USING btree ("created_at");
--> statement-breakpoint
CREATE POLICY "outbox_select_staff" ON "outbox" AS PERMISSIVE FOR SELECT TO "authenticated"
USING ((select public.current_role()) in ('concierge', 'admin'));
--> statement-breakpoint
CREATE POLICY "outbox_insert_staff" ON "outbox" AS PERMISSIVE FOR INSERT TO "authenticated"
WITH CHECK ((select public.current_role()) in ('concierge', 'admin'));
--> statement-breakpoint
CREATE POLICY "outbox_update_staff" ON "outbox" AS PERMISSIVE FOR UPDATE TO "authenticated"
USING ((select public.current_role()) in ('concierge', 'admin'))
WITH CHECK ((select public.current_role()) in ('concierge', 'admin'));
--> statement-breakpoint
CREATE POLICY "outbox_service_all" ON "outbox" AS PERMISSIVE FOR ALL TO "service_role"
USING (true) WITH CHECK (true);
