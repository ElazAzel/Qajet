import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireCurrentUser } from '../../../../lib/current-user';
import { STORAGE_BUCKET, SupabaseStorageAdapter } from '../../../../lib/storage/adapter';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireCurrentUser();
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: attachment } = await supabase
    .from('attachments')
    .select('object_key')
    .eq('id', id)
    .maybeSingle();
  if (!attachment) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 });

  let storageClient: SupabaseClient;
  try {
    storageClient = createSupabaseAdminClient();
  } catch {
    storageClient = supabase;
  }
  const storage = new SupabaseStorageAdapter(storageClient, STORAGE_BUCKET);
  try {
    const url = await storage.getDownloadUrl(attachment.object_key, 60);
    return NextResponse.redirect(url, { status: 302 });
  } catch {
    return NextResponse.json({ error: 'Файл временно недоступен' }, { status: 503 });
  }
}
