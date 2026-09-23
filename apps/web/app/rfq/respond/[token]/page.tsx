import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { formatDate, NUMERIC_DATE } from '../../../lib/dates';
import { verifyRfqResponseToken } from '../../../lib/rfq-response';
import { type PublicRfqDetail, PublicRfqResponse } from './_public-response';

export default async function PublicRfqResponsePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const payload = verifyRfqResponseToken(token);
  if (!payload) notFound();

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('get_rfq_quick_response', {
    p_rfq_id: payload.rfqId,
    p_token: payload.nonce,
  });
  if (error || !data) notFound();

  const detail = data as unknown as PublicRfqDetail;
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <p className="mb-4 text-fine text-muted">
        <Link href="/" className="hover:text-ink">
          QAJET
        </Link>
        <span className="mx-1.5">›</span>
        <span className="font-medium text-ink">Ответ на RFQ</span>
      </p>
      <h1 className="text-2xl font-extrabold text-ink">{detail.request.title}</h1>
      <p className="mt-1.5 text-fine text-muted">
        Ответить до {formatDate(detail.respondBy, NUMERIC_DATE)}
        {detail.request.deadlineDate &&
          ` · доставка к ${formatDate(detail.request.deadlineDate, NUMERIC_DATE)}`}
      </p>
      <PublicRfqResponse token={token} detail={detail} />
    </div>
  );
}
