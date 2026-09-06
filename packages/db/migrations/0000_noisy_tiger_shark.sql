CREATE TYPE "public"."alias_kind" AS ENUM('category', 'material', 'unit', 'capability');--> statement-breakpoint
CREATE TYPE "public"."change_request_status" AS ENUM('pending', 'accepted', 'declined');--> statement-breakpoint
CREATE TYPE "public"."company_type" AS ENUM('buyer', 'supplier');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('prepay_invoice', 'supplier_invoice', 'act', 'final_invoice', 'refund_confirmation', 'spec');--> statement-breakpoint
CREATE TYPE "public"."model_name" AS ENUM('estimator', 'matcher', 'leadtime');--> statement-breakpoint
CREATE TYPE "public"."order_state" AS ENUM('draft', 'estimated', 'prepaid', 'rfq_sent', 'quotes_received', 'plan_proposed', 'plan_approved', 'suppliers_paid', 'in_production', 'shipped', 'delivered', 'accepted', 'closed', 'awaiting_internal_approval', 'on_hold', 'cancelled', 'disputed');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('pending', 'paid');--> statement-breakpoint
CREATE TYPE "public"."plan_kind" AS ENUM('recommended', 'cheaper', 'more_slack', 'manual');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('draft', 'proposed', 'approved', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."prepayment_status" AS ENUM('issued', 'paid');--> statement-breakpoint
CREATE TYPE "public"."quote_source" AS ENUM('form', 'file', 'manual');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('draft', 'submitted', 'needs_clarification', 'estimated', 'closed');--> statement-breakpoint
CREATE TYPE "public"."rfq_status" AS ENUM('sent', 'quick_responded', 'quoted', 'declined', 'expired');--> statement-breakpoint
CREATE TYPE "public"."settlement" AS ENUM('refund', 'surcharge', 'exact');--> statement-breakpoint
CREATE TYPE "public"."tax_mode" AS ENUM('general', 'simplified', 'retail', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."thread_kind" AS ENUM('buyer', 'supplier', 'internal');--> statement-breakpoint
CREATE TYPE "public"."time_entry_stage" AS ENUM('intake', 'sourcing', 'normalization', 'approval', 'execution', 'exception', 'closing');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'manager', 'concierge', 'admin');--> statement-breakpoint
CREATE TYPE "public"."vat_status" AS ENUM('registered', 'not_registered', 'unknown');--> statement-breakpoint
CREATE TABLE "change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"proposed_plan_id" uuid NOT NULL,
	"initiator_user_id" uuid NOT NULL,
	"diff" jsonb NOT NULL,
	"status" "change_request_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "change_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"change_request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid,
	"request_id" uuid,
	"kind" "thread_kind" NOT NULL,
	"supplier_company_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "threads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "company_type" NOT NULL,
	"name" text NOT NULL,
	"bin" text,
	"tax_mode" "tax_mode" DEFAULT 'unknown' NOT NULL,
	"vat_status" "vat_status" DEFAULT 'unknown' NOT NULL,
	"verified_at" timestamp with time zone,
	"verification_note" text,
	"city" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "permissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "supplier_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"capabilities" text[] DEFAULT '{}'::text[] NOT NULL,
	"min_order_kzt" bigint,
	"lead_time_days_default" integer,
	"portfolio_urls" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_profiles_company_id_unique" UNIQUE("company_id")
);
--> statement-breakpoint
ALTER TABLE "supplier_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "supplier_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"orders_total" integer DEFAULT 0 NOT NULL,
	"orders_on_time" integer DEFAULT 0 NOT NULL,
	"orders_disputed" integer DEFAULT 0 NOT NULL,
	"avg_buyer_score" integer,
	"rfq_sent" integer DEFAULT 0 NOT NULL,
	"rfq_answered" integer DEFAULT 0 NOT NULL,
	"median_response_hours" integer,
	"lead_time_multiplier" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_stats_company_id_unique" UNIQUE("company_id")
);
--> statement-breakpoint
ALTER TABLE "supplier_stats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"role" "user_role" NOT NULL,
	"approval_limit_kzt" bigint,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "extraction_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alias" text NOT NULL,
	"canonical" text NOT NULL,
	"kind" "alias_kind" NOT NULL,
	"hits" integer DEFAULT 1 NOT NULL,
	"confirmed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "extraction_aliases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "learning_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "learning_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "model_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model" "model_name" NOT NULL,
	"params" jsonb NOT NULL,
	"metrics" jsonb NOT NULL,
	"trained_at" timestamp with time zone DEFAULT now() NOT NULL,
	"n_samples" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "model_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "price_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"item_key" text NOT NULL,
	"qty" integer NOT NULL,
	"unit_price_kzt" bigint NOT NULL,
	"supplier_company_id" uuid,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "price_observations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"supplier_company_id" uuid NOT NULL,
	"buyer_score_1_5" integer NOT NULL,
	"was_on_time" boolean NOT NULL,
	"had_dispute" boolean DEFAULT false NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ratings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"stage" time_entry_stage NOT NULL,
	"seconds" integer NOT NULL,
	"source" text DEFAULT 'auto' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"type" "document_type" NOT NULL,
	"url" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "estimates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"p50_kzt" bigint NOT NULL,
	"p80_kzt" bigint NOT NULL,
	"margin_pct" real NOT NULL,
	"basis" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "estimates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "order_stage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"from_state" "order_state",
	"to_state" "order_state" NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "order_stage_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"approved_plan_id" uuid NOT NULL,
	"state" "order_state" DEFAULT 'draft' NOT NULL,
	"concierge_user_id" uuid,
	"accepted_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"final_cost_kzt" bigint,
	"settlement" "settlement",
	"settlement_amount_kzt" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "plan_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"request_item_id" uuid NOT NULL,
	"supplier_company_id" uuid NOT NULL,
	"quote_line_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"line_total_kzt" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "plan_rejections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"plan_context" text NOT NULL,
	"quote_line_id" uuid,
	"reason_code" text NOT NULL,
	"reason_human" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_rejections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"kind" "plan_kind" NOT NULL,
	"total_supplier_kzt" bigint NOT NULL,
	"delivery_kzt" bigint NOT NULL,
	"commission_kzt" bigint NOT NULL,
	"commission_base" text NOT NULL,
	"tax_effect_kzt" bigint DEFAULT 0 NOT NULL,
	"total_kzt" bigint NOT NULL,
	"eta_date" date,
	"slack_days" integer,
	"supplier_count" integer NOT NULL,
	"explanation" jsonb NOT NULL,
	"status" "plan_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "prepayments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"amount_kzt" bigint NOT NULL,
	"invoice_no" text,
	"status" "prepayment_status" DEFAULT 'issued' NOT NULL,
	"paid_at" timestamp with time zone,
	"proof_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prepayments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "quote_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"request_item_id" uuid NOT NULL,
	"unit_price_kzt" bigint NOT NULL,
	"min_qty" integer,
	"setup_fee_kzt" bigint DEFAULT 0 NOT NULL,
	"lead_time_days" integer NOT NULL,
	"bundle_rule" jsonb,
	"capability_confirmed" boolean DEFAULT false NOT NULL,
	"field_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quote_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rfq_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_until" date,
	"currency" text DEFAULT 'KZT' NOT NULL,
	"notes" text,
	"source" "quote_source" DEFAULT 'form' NOT NULL,
	"file_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quotes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "request_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"qty" integer NOT NULL,
	"unit" text NOT NULL,
	"specs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"required_capabilities" text[] DEFAULT '{}'::text[] NOT NULL,
	"needs_clarification" boolean DEFAULT false NOT NULL,
	"clarification_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "request_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_company_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"title" text NOT NULL,
	"raw_text" text NOT NULL,
	"deadline_date" date,
	"budget_kzt" bigint,
	"delivery_address" text,
	"city" text,
	"status" "request_status" DEFAULT 'draft' NOT NULL,
	"extraction_confidence" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rfqs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"supplier_company_id" uuid NOT NULL,
	"token" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"respond_by" timestamp with time zone,
	"status" "rfq_status" DEFAULT 'sent' NOT NULL,
	"assigned_supplier_user_id" uuid,
	"selection_reason" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_exploration" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rfqs_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "rfqs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "supplier_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"supplier_company_id" uuid NOT NULL,
	"amount_kzt" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp with time zone,
	"doc_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_payouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_proposed_plan_id_plans_id_fk" FOREIGN KEY ("proposed_plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_initiator_user_id_users_id_fk" FOREIGN KEY ("initiator_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_profiles" ADD CONSTRAINT "supplier_profiles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_stats" ADD CONSTRAINT "supplier_stats_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_aliases" ADD CONSTRAINT "extraction_aliases_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_supplier_company_id_companies_id_fk" FOREIGN KEY ("supplier_company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_supplier_company_id_companies_id_fk" FOREIGN KEY ("supplier_company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_stage_events" ADD CONSTRAINT "order_stage_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_stage_events" ADD CONSTRAINT "order_stage_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_approved_plan_id_plans_id_fk" FOREIGN KEY ("approved_plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_concierge_user_id_users_id_fk" FOREIGN KEY ("concierge_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_lines" ADD CONSTRAINT "plan_lines_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_lines" ADD CONSTRAINT "plan_lines_request_item_id_request_items_id_fk" FOREIGN KEY ("request_item_id") REFERENCES "public"."request_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_lines" ADD CONSTRAINT "plan_lines_supplier_company_id_companies_id_fk" FOREIGN KEY ("supplier_company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_lines" ADD CONSTRAINT "plan_lines_quote_line_id_quote_lines_id_fk" FOREIGN KEY ("quote_line_id") REFERENCES "public"."quote_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_rejections" ADD CONSTRAINT "plan_rejections_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_rejections" ADD CONSTRAINT "plan_rejections_quote_line_id_quote_lines_id_fk" FOREIGN KEY ("quote_line_id") REFERENCES "public"."quote_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepayments" ADD CONSTRAINT "prepayments_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_request_item_id_request_items_id_fk" FOREIGN KEY ("request_item_id") REFERENCES "public"."request_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_items" ADD CONSTRAINT "request_items_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_buyer_company_id_companies_id_fk" FOREIGN KEY ("buyer_company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_supplier_company_id_companies_id_fk" FOREIGN KEY ("supplier_company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_assigned_supplier_user_id_users_id_fk" FOREIGN KEY ("assigned_supplier_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payouts" ADD CONSTRAINT "supplier_payouts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payouts" ADD CONSTRAINT "supplier_payouts_supplier_company_id_companies_id_fk" FOREIGN KEY ("supplier_company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_requests_order_id_idx" ON "change_requests" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "change_requests_proposed_plan_id_idx" ON "change_requests" USING btree ("proposed_plan_id");--> statement-breakpoint
CREATE INDEX "change_requests_initiator_user_id_idx" ON "change_requests" USING btree ("initiator_user_id");--> statement-breakpoint
CREATE INDEX "messages_thread_id_idx" ON "messages" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "messages_author_user_id_idx" ON "messages" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "threads_order_id_idx" ON "threads" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "threads_request_id_idx" ON "threads" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "permissions_user_id_idx" ON "permissions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_company_id_idx" ON "users" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "extraction_aliases_confirmed_by_idx" ON "extraction_aliases" USING btree ("confirmed_by");--> statement-breakpoint
CREATE INDEX "price_observations_supplier_company_id_idx" ON "price_observations" USING btree ("supplier_company_id");--> statement-breakpoint
CREATE INDEX "ratings_order_id_idx" ON "ratings" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "ratings_supplier_company_id_idx" ON "ratings" USING btree ("supplier_company_id");--> statement-breakpoint
CREATE INDEX "time_entries_order_id_idx" ON "time_entries" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "time_entries_user_id_idx" ON "time_entries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "documents_order_id_idx" ON "documents" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "estimates_request_id_idx" ON "estimates" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "order_stage_events_order_id_idx" ON "order_stage_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_stage_events_actor_user_id_idx" ON "order_stage_events" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "orders_approved_plan_id_idx" ON "orders" USING btree ("approved_plan_id");--> statement-breakpoint
CREATE INDEX "orders_concierge_user_id_idx" ON "orders" USING btree ("concierge_user_id");--> statement-breakpoint
CREATE INDEX "plan_lines_plan_id_idx" ON "plan_lines" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "plan_lines_request_item_id_idx" ON "plan_lines" USING btree ("request_item_id");--> statement-breakpoint
CREATE INDEX "plan_lines_supplier_company_id_idx" ON "plan_lines" USING btree ("supplier_company_id");--> statement-breakpoint
CREATE INDEX "plan_lines_quote_line_id_idx" ON "plan_lines" USING btree ("quote_line_id");--> statement-breakpoint
CREATE INDEX "plan_rejections_request_id_idx" ON "plan_rejections" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "plan_rejections_quote_line_id_idx" ON "plan_rejections" USING btree ("quote_line_id");--> statement-breakpoint
CREATE INDEX "plans_request_id_idx" ON "plans" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "prepayments_request_id_idx" ON "prepayments" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "quote_lines_quote_id_idx" ON "quote_lines" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "quote_lines_request_item_id_idx" ON "quote_lines" USING btree ("request_item_id");--> statement-breakpoint
CREATE INDEX "quotes_rfq_id_idx" ON "quotes" USING btree ("rfq_id");--> statement-breakpoint
CREATE INDEX "request_items_request_id_idx" ON "request_items" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "requests_buyer_company_id_idx" ON "requests" USING btree ("buyer_company_id");--> statement-breakpoint
CREATE INDEX "requests_created_by_idx" ON "requests" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "rfqs_request_id_idx" ON "rfqs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "rfqs_supplier_company_id_idx" ON "rfqs" USING btree ("supplier_company_id");--> statement-breakpoint
CREATE INDEX "rfqs_assigned_supplier_user_id_idx" ON "rfqs" USING btree ("assigned_supplier_user_id");--> statement-breakpoint
CREATE INDEX "supplier_payouts_order_id_idx" ON "supplier_payouts" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "supplier_payouts_supplier_company_id_idx" ON "supplier_payouts" USING btree ("supplier_company_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.current_company_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT company_id FROM public.users WHERE id = auth.uid()
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.current_role()
RETURNS user_role
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM public.users WHERE id = auth.uid()
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.current_company_id() FROM public, anon;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.current_role() FROM public, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.current_company_id() TO authenticated, service_role;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.current_role() TO authenticated, service_role;--> statement-breakpoint
CREATE POLICY "change_requests_select_via_order" ON "change_requests" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("change_requests"."order_id" in (select id from "orders"));--> statement-breakpoint
CREATE POLICY "change_requests_service_all" ON "change_requests" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "messages_select_via_thread" ON "messages" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("messages"."thread_id" in (select id from "threads"));--> statement-breakpoint
CREATE POLICY "messages_insert_via_thread" ON "messages" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("messages"."thread_id" in (select id from "threads") and "messages"."author_user_id" = (select id from "users" where id = (select auth.uid())));--> statement-breakpoint
CREATE POLICY "messages_service_all" ON "messages" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "threads_select_staff" ON "threads" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.current_role() in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "threads_select_buyer" ON "threads" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("threads"."kind" = 'buyer' and (
        "threads"."request_id" in (select id from "requests") or
        "threads"."order_id" in (select id from "orders")
      ));--> statement-breakpoint
CREATE POLICY "threads_select_own_supplier" ON "threads" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("threads"."kind" = 'supplier' and "threads"."supplier_company_id" = public.current_company_id());--> statement-breakpoint
CREATE POLICY "threads_service_all" ON "threads" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "companies_select_own" ON "companies" AS PERMISSIVE FOR SELECT TO "authenticated" USING (id = public.current_company_id());--> statement-breakpoint
CREATE POLICY "companies_select_staff" ON "companies" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.current_role() in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "companies_service_all" ON "companies" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "permissions_select_own_company" ON "permissions" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("permissions"."user_id" in (select id from "users" where company_id = public.current_company_id()));--> statement-breakpoint
CREATE POLICY "permissions_service_all" ON "permissions" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "supplier_profiles_select_all" ON "supplier_profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "supplier_profiles_update_own" ON "supplier_profiles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("supplier_profiles"."company_id" = public.current_company_id()) WITH CHECK ("supplier_profiles"."company_id" = public.current_company_id());--> statement-breakpoint
CREATE POLICY "supplier_profiles_service_all" ON "supplier_profiles" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "supplier_stats_select_all" ON "supplier_stats" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "supplier_stats_service_all" ON "supplier_stats" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "users_select_self" ON "users" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("users"."id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "users_select_same_company" ON "users" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("users"."company_id" = public.current_company_id());--> statement-breakpoint
CREATE POLICY "users_select_staff" ON "users" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.current_role() in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "users_service_all" ON "users" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "extraction_aliases_select_staff" ON "extraction_aliases" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.current_role() in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "extraction_aliases_service_all" ON "extraction_aliases" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "learning_events_select_staff" ON "learning_events" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.current_role() in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "learning_events_service_all" ON "learning_events" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "model_snapshots_select_staff" ON "model_snapshots" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.current_role() in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "model_snapshots_service_all" ON "model_snapshots" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "price_observations_select_staff" ON "price_observations" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.current_role() in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "price_observations_service_all" ON "price_observations" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "ratings_select_staff" ON "ratings" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.current_role() in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "ratings_select_own_supplier" ON "ratings" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("ratings"."supplier_company_id" = public.current_company_id());--> statement-breakpoint
CREATE POLICY "ratings_select_via_order" ON "ratings" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("ratings"."order_id" in (select id from "orders"));--> statement-breakpoint
CREATE POLICY "ratings_insert_via_order" ON "ratings" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("ratings"."order_id" in (select id from "orders"));--> statement-breakpoint
CREATE POLICY "ratings_service_all" ON "ratings" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "settings_select_staff" ON "settings" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.current_role() in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "settings_service_all" ON "settings" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "time_entries_select_staff" ON "time_entries" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.current_role() in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "time_entries_insert_own" ON "time_entries" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (public.current_role() in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "time_entries_service_all" ON "time_entries" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "documents_select_via_order" ON "documents" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("documents"."order_id" in (select id from "orders"));--> statement-breakpoint
CREATE POLICY "documents_service_all" ON "documents" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "estimates_select_via_request" ON "estimates" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("estimates"."request_id" in (select id from "requests"));--> statement-breakpoint
CREATE POLICY "estimates_service_all" ON "estimates" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "order_stage_events_select_via_order" ON "order_stage_events" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("order_stage_events"."order_id" in (select id from "orders"));--> statement-breakpoint
CREATE POLICY "order_stage_events_service_insert" ON "order_stage_events" AS PERMISSIVE FOR INSERT TO "service_role" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "order_stage_events_service_select" ON "order_stage_events" AS PERMISSIVE FOR SELECT TO "service_role" USING (true);--> statement-breakpoint
CREATE POLICY "orders_select_via_request" ON "orders" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("orders"."request_id" in (select id from "requests"));--> statement-breakpoint
CREATE POLICY "orders_select_supplier_in_plan" ON "orders" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("orders"."approved_plan_id" in (
        select plan_id from "plan_lines" where supplier_company_id = public.current_company_id()
      ));--> statement-breakpoint
CREATE POLICY "orders_service_all" ON "orders" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "plan_lines_select_via_plan" ON "plan_lines" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("plan_lines"."plan_id" in (select id from "plans"));--> statement-breakpoint
CREATE POLICY "plan_lines_service_all" ON "plan_lines" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "plan_rejections_select_via_request" ON "plan_rejections" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("plan_rejections"."request_id" in (select id from "requests"));--> statement-breakpoint
CREATE POLICY "plan_rejections_service_all" ON "plan_rejections" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "plans_select_via_request" ON "plans" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("plans"."request_id" in (select id from "requests"));--> statement-breakpoint
CREATE POLICY "plans_service_all" ON "plans" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "prepayments_select_via_request" ON "prepayments" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("prepayments"."request_id" in (select id from "requests"));--> statement-breakpoint
CREATE POLICY "prepayments_service_all" ON "prepayments" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "quote_lines_select_own_supplier" ON "quote_lines" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("quote_lines"."quote_id" in (
        select id from "quotes" where rfq_id in (
          select id from "rfqs" where supplier_company_id = public.current_company_id()
        )
      ));--> statement-breakpoint
CREATE POLICY "quote_lines_select_buyer_of_request" ON "quote_lines" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("quote_lines"."quote_id" in (
        select id from "quotes" where rfq_id in (
          select id from "rfqs" where request_id in (select id from "requests")
        )
      ));--> statement-breakpoint
CREATE POLICY "quote_lines_select_staff" ON "quote_lines" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.current_role() in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "quote_lines_service_all" ON "quote_lines" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "quotes_select_own_supplier" ON "quotes" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("quotes"."rfq_id" in (select id from "rfqs" where supplier_company_id = public.current_company_id()));--> statement-breakpoint
CREATE POLICY "quotes_select_buyer_of_request" ON "quotes" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("quotes"."rfq_id" in (select id from "rfqs" where request_id in (select id from "requests")));--> statement-breakpoint
CREATE POLICY "quotes_select_staff" ON "quotes" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.current_role() in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "quotes_insert_own_supplier" ON "quotes" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("quotes"."rfq_id" in (select id from "rfqs" where supplier_company_id = public.current_company_id()));--> statement-breakpoint
CREATE POLICY "quotes_service_all" ON "quotes" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "request_items_select_via_request" ON "request_items" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("request_items"."request_id" in (select id from "requests"));--> statement-breakpoint
CREATE POLICY "request_items_service_all" ON "request_items" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "requests_select_own_company" ON "requests" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("requests"."buyer_company_id" = public.current_company_id());--> statement-breakpoint
CREATE POLICY "requests_select_staff" ON "requests" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.current_role() in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "requests_insert_own_company" ON "requests" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("requests"."buyer_company_id" = public.current_company_id());--> statement-breakpoint
CREATE POLICY "requests_service_all" ON "requests" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "rfqs_select_own_supplier" ON "rfqs" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("rfqs"."supplier_company_id" = public.current_company_id());--> statement-breakpoint
CREATE POLICY "rfqs_select_buyer_of_request" ON "rfqs" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("rfqs"."request_id" in (select id from "requests"));--> statement-breakpoint
CREATE POLICY "rfqs_select_staff" ON "rfqs" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.current_role() in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "rfqs_update_own_supplier" ON "rfqs" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("rfqs"."supplier_company_id" = public.current_company_id()) WITH CHECK ("rfqs"."supplier_company_id" = public.current_company_id());--> statement-breakpoint
CREATE POLICY "rfqs_service_all" ON "rfqs" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "supplier_payouts_select_own_supplier" ON "supplier_payouts" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("supplier_payouts"."supplier_company_id" = public.current_company_id());--> statement-breakpoint
CREATE POLICY "supplier_payouts_select_staff" ON "supplier_payouts" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.current_role() in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "supplier_payouts_service_all" ON "supplier_payouts" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);