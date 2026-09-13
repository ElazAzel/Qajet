import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireCurrentUser } from '../../../../lib/current-user';

const RENDERABLE_DOCUMENT_TYPES = new Set(['prepay_invoice', 'act', 'final_invoice']);

/**
 * Stable download/print entry point. The document id is only a lookup key:
 * RLS checks the current buyer/staff/supplier before the redirect is issued.
 * Supplier invoices deliberately do not resolve through the buyer-facing
 * renderer and remain restricted to their own internal path.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireCurrentUser();
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: document } = await supabase
    .from('documents')
    .select('order_id, type')
    .eq('id', id)
    .maybeSingle();

  if (!document) return NextResponse.json({ error: 'Документ не найден' }, { status: 404 });
  if (!RENDERABLE_DOCUMENT_TYPES.has(document.type)) {
    return NextResponse.json(
      { error: 'Этот документ нельзя открыть в общем просмотрщике' },
      { status: 403 },
    );
  }

  const url = new URL(`/documents/${document.order_id}`, request.url);
  url.searchParams.set('type', document.type);
  return NextResponse.redirect(url, { status: 302 });
}
