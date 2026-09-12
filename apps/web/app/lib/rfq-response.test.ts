import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRfqResponseToken, verifyRfqResponseToken } from './rfq-response';
import { createSignedLink } from './signed-link';

describe('rfq response links', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('binds the RFQ id and nonce to the dedicated scope', () => {
    vi.stubEnv('LINK_SIGNING_SECRET', 'rfq-test-secret');
    const token = createRfqResponseToken('00000000-0000-0000-0000-000000000001', 'nonce-1');
    expect(verifyRfqResponseToken(token)).toEqual({
      rfqId: '00000000-0000-0000-0000-000000000001',
      nonce: 'nonce-1',
    });
    expect(verifyRfqResponseToken(`${token}x`)).toBeNull();
  });

  it('rejects a valid token with a different signed-link scope', () => {
    vi.stubEnv('LINK_SIGNING_SECRET', 'rfq-test-secret');
    const token = createSignedLink(
      'metrics_jury',
      { rfqId: '00000000-0000-0000-0000-000000000001', nonce: 'nonce-1' },
      3600,
    );
    expect(verifyRfqResponseToken(token)).toBeNull();
  });
});
