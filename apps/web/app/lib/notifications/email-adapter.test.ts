import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmailAdapter } from './email-adapter';

const message = {
  idempotencyKey: 'key-1',
  recipient: 'supplier@example.test',
  subject: 'RFQ',
  body: 'body',
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('createEmailAdapter', () => {
  it('в production без ключа отказывает, а не притворяется отправкой', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RESEND_API_KEY', '');
    expect(() => createEmailAdapter()).toThrow(/RESEND_API_KEY/);
  });

  it('пробельный ключ в production — то же самое, что его отсутствие', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RESEND_API_KEY', '   ');
    expect(() => createEmailAdapter()).toThrow(/RESEND_API_KEY/);
  });

  it('вне production без ключа остаётся локальный приёмник и он назван честно', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('RESEND_API_KEY', '');
    const delivered = await createEmailAdapter().send(message);
    expect(delivered.transport).toBe('local-sink');
  });

  it('в production с ключом отправляет через провайдера', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RESEND_API_KEY', 're_test_key');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'resend-msg-1' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const delivered = await createEmailAdapter().send(message);
    expect(delivered).toEqual({ providerMessageId: 'resend-msg-1', transport: 'resend' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
