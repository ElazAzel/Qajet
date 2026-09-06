import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Перечисления — agents.md §3, §5, §6. Значения дословно из спеки,
 * не сокращать и не переименовывать без правки agents.md.
 */

export const companyTypeEnum = pgEnum('company_type', ['buyer', 'supplier']);

export const taxModeEnum = pgEnum('tax_mode', ['general', 'simplified', 'retail', 'unknown']);

export const vatStatusEnum = pgEnum('vat_status', ['registered', 'not_registered', 'unknown']);

export const userRoleEnum = pgEnum('user_role', ['owner', 'manager', 'concierge', 'admin']);

export const requestStatusEnum = pgEnum('request_status', [
  'draft',
  'submitted',
  'needs_clarification',
  'estimated',
  'closed',
]);

export const rfqStatusEnum = pgEnum('rfq_status', [
  'sent',
  'quick_responded',
  'quoted',
  'declined',
  'expired',
]);

export const quoteSourceEnum = pgEnum('quote_source', ['form', 'file', 'manual']);

export const planKindEnum = pgEnum('plan_kind', ['recommended', 'cheaper', 'more_slack', 'manual']);

export const planStatusEnum = pgEnum('plan_status', [
  'draft',
  'proposed',
  'approved',
  'superseded',
]);

/** Машина состояний заказа — agents.md §6, дословно. */
export const orderStateEnum = pgEnum('order_state', [
  'draft',
  'estimated',
  'prepaid',
  'rfq_sent',
  'quotes_received',
  'plan_proposed',
  'plan_approved',
  'suppliers_paid',
  'in_production',
  'shipped',
  'delivered',
  'accepted',
  'closed',
  'awaiting_internal_approval',
  'on_hold',
  'cancelled',
  'disputed',
]);

export const settlementEnum = pgEnum('settlement', ['refund', 'surcharge', 'exact']);

export const prepaymentStatusEnum = pgEnum('prepayment_status', ['issued', 'paid']);

export const documentTypeEnum = pgEnum('document_type', [
  'prepay_invoice',
  'supplier_invoice',
  'act',
  'final_invoice',
  'refund_confirmation',
  'spec',
]);

export const threadKindEnum = pgEnum('thread_kind', ['buyer', 'supplier', 'internal']);

export const changeRequestStatusEnum = pgEnum('change_request_status', [
  'pending',
  'accepted',
  'declined',
]);

export const timeEntryStageEnum = pgEnum('time_entry_stage', [
  'intake',
  'sourcing',
  'normalization',
  'approval',
  'execution',
  'exception',
  'closing',
]);

export const modelNameEnum = pgEnum('model_name', ['estimator', 'matcher', 'leadtime']);

export const aliasKindEnum = pgEnum('alias_kind', ['category', 'material', 'unit', 'capability']);

export const payoutStatusEnum = pgEnum('payout_status', ['pending', 'paid']);
