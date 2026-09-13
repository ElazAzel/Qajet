import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  const missing = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'].filter(
    (name) => !process.env[name],
  );
  if (missing.length > 0) {
    return NextResponse.json({ ok: false, dependency: 'supabase', missing }, { status: 503 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from('settings').select('key').limit(1);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, dependency: 'supabase', at: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        dependency: 'supabase',
        error: process.env.NODE_ENV === 'production' ? 'database unavailable' : String(error),
      },
      { status: 503 },
    );
  }
}
