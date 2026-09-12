import 'server-only';

import { createClient } from '@supabase/supabase-js';

/**
 * Service-role access is isolated to the owner-only invitation action.
 * Never import this module from a Client Component or a public page.
 */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY не задан — приглашения отключены.');
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
