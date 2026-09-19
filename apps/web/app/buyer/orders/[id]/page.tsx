import { notFound, permanentRedirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireCurrentUser } from '../../../lib/current-user';

/**
 * Прежний адрес закупки. Каноническая страница теперь /buyer/requests/[id]:
 * заявка существует раньше заказа, поэтому ключом стала она. Старые ссылки
 * (письма, закладки, сообщения) продолжают работать.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LegacyBuyerOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireCurrentUser();
  if (!UUID.test(id)) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: order } = await supabase
    .from('orders')
    .select('request_id')
    .eq('id', id)
    .maybeSingle();
  if (!order) notFound();
  permanentRedirect(`/buyer/requests/${order.request_id}`);
}
