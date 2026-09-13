import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireActor } from '../../../../lib/current-user';

/** Order-scoped entry point kept for deep links; the conversation workspace
 * still renders all supplier threads with the same RLS boundary. */
export default async function SupplierOrderMessagesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireActor('supplier');
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: thread } = await supabase
    .from('threads')
    .select('id')
    .eq('order_id', id)
    .eq('kind', 'supplier')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  redirect(thread ? `/supplier/messages?thread=${thread.id}` : '/supplier/messages');
}
