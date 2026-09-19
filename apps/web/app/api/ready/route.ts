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
] as const;

export async function GET() {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    return NextResponse.json({ ok: false, dependency: 'env', missing }, { status: 503 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from('settings').select('key').limit(1);
    if (error) throw new Error('settings read failed');
    return NextResponse.json({ ok: true, dependency: 'supabase', at: new Date().toISOString() });
  } catch {
    return NextResponse.json(
      { ok: false, dependency: 'supabase', error: 'database unavailable' },
      { status: 503 },
    );
  }
}
