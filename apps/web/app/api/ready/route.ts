import { validateRequisites } from '@qajet/engine/client-requisites';
import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/**
 * Готовность к работе. Проверка идёт через service-role клиент, поэтому
 * SUPABASE_SERVICE_ROLE_KEY входит в обязательные переменные: раньше его
 * отсутствие в production рапортовалось как «database unavailable», что
 * скрывало настоящую причину 503. Имена переменных не секрет, значения не
 * возвращаются никогда.
 */
const REQUIRED_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SITE_URL',
  'LINK_SIGNING_SECRET',
  'CRON_SECRET',
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
] as const;

export async function GET() {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    return NextResponse.json({ ok: false, dependency: 'env', missing }, { status: 503 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from('settings')
      .select('key, value')
      .in('key', ['environment_kind', 'qajet_requisites']);
    if (error) throw new Error('settings read failed');
    const settings = new Map((data ?? []).map((row) => [row.key, row.value]));
    if (
      settings.get('environment_kind') !== 'clients' ||
      !validateRequisites(settings.get('qajet_requisites')).ok
    ) {
      return NextResponse.json({ ok: false, dependency: 'client_configuration' }, { status: 503 });
    }
    return NextResponse.json({
      ok: true,
      dependency: 'supabase',
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? 'local',
      at: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { ok: false, dependency: 'supabase', error: 'database unavailable' },
      { status: 503 },
    );
  }
}
