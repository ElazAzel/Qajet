import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabasePdBackend, type PdBackend } from './backend';

export type { DeliveryAddress, PdBackend, UserContact } from './backend';
export { createSupabasePdBackend } from './backend';
export type { MaskedPayload, MaskResult, PiiEntity, PiiEntityType, UnmaskMap } from './mask';
export { maskPII, unmaskPII } from './mask';

/**
 * Единственная точка входа для остального кода: `createPdClient(supabase)`
 * вместо прямого `supabase.from('users')`/`.from('requests')` в apps/web.
 * Сегодня всегда возвращает Supabase-бэкенд; переезд на казахстанский ДЦ
 * (agents.md §11.1) — замена реализации здесь, без изменений вызывающих
 * мест.
 */
export function createPdClient(supabase: SupabaseClient): PdBackend {
  return createSupabasePdBackend(supabase);
}
