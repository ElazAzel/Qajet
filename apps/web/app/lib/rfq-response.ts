import { createSignedLink, verifySignedLink } from './signed-link';

export const RFQ_RESPONSE_SCOPE = 'rfq_respond';
/** Ссылка живёт 5 дней — достаточно для окна ответа, но не бессрочно. */
export const RFQ_RESPONSE_LINK_TTL_SECONDS = 60 * 60 * 24 * 5;

export interface RfqResponsePayload {
  rfqId: string;
  nonce: string;
}

export function createRfqResponseToken(rfqId: string, nonce: string): string {
  return createSignedLink(
    RFQ_RESPONSE_SCOPE,
    { rfqId, nonce } satisfies RfqResponsePayload,
    RFQ_RESPONSE_LINK_TTL_SECONDS,
  );
}

export function verifyRfqResponseToken(token: string): RfqResponsePayload | null {
  const payload = verifySignedLink<Partial<RfqResponsePayload>>(token, RFQ_RESPONSE_SCOPE);
  if (!payload || typeof payload.rfqId !== 'string' || typeof payload.nonce !== 'string') {
    return null;
  }
  return { rfqId: payload.rfqId, nonce: payload.nonce };
}
