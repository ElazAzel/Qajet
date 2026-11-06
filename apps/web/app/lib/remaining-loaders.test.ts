import { describe, expect, it } from 'vitest';
import { database } from '../../test/postgrest-fixture';
import { loadBuyerCase, loadBuyerCases } from './buyer-case';
import { loadBuyerThreads, loadThreadAttachments, loadThreadMessages } from './buyer-messages';
import { loadSupplierHome } from './supplier-home';
import { loadSupplierThreads } from './supplier-messages';

const timestamp = '2026-01-01T00:00:00.000Z';
const id = (n: number) => String(n).padStart(8, '0');

describe('remaining buyer and supplier loaders', () => {
  it('paginates read markers for over 1000 threads using their real compound-key column', async () => {
    const threads = Array.from({ length: 1001 }, (_, n) => ({ id: id(n), kind: 'supplier' }));
    const messages = threads.map((row) => ({
      id: row.id,
      thread_id: row.id,
      created_at: timestamp,
      body: 'E2E read',
      author_user_id: 'other',
    }));
    const thread_reads = threads.map((row) => ({
      thread_id: row.id,
      user_id: 'self',
      last_read_at: '2026-02-01',
    }));
    const result = await loadSupplierThreads(database({ threads, messages, thread_reads }), 'self');
    expect(result).toHaveLength(1001);
    expect(result.every((row) => row.unreadCount === 0)).toBe(true);
  });
  it('uses the latest quote and every unconfirmed line beyond embedded row caps', async () => {
    const quotes = Array.from({ length: 1001 }, (_, n) => ({
      id: id(n),
      rfq_id: 'rfq',
      version: n + 1,
      submitted_at: n === 1000 ? '2026-02-01' : timestamp,
      quote_lines: [],
    }));
    const result = await loadSupplierHome(
      database({
        rfqs: [
          {
            id: 'rfq',
            request_id: 'request',
            status: 'quoted',
            requests: { title: 'E2E quote' },
            quotes: quotes.slice(0, 1000),
          },
        ],
        quotes,
        quote_lines: Array.from({ length: 1001 }, (_, n) => ({
          id: id(n),
          quote_id: id(1000),
          capability_confirmed: false,
        })),
      }),
      null,
    );
    expect(result.sentQuotes[0]?.submittedAt).toBe('2026-02-01');
    expect(result.sentQuotes[0]?.unconfirmedCount).toBe(1001);
  });
  it('loads 1001 buyer cases and the last request ETA without oversized IN filters', async () => {
    const requests = Array.from({ length: 1001 }, (_, n) => ({
      id: id(n),
      title: 'E2E request',
      status: 'submitted',
      updated_at: timestamp,
      orders: [],
    }));
    const result = await loadBuyerCases(
      database({
        requests,
        plans: [
          {
            id: 'plan',
            request_id: id(1000),
            eta_date: '2026-12-01',
            version: 1,
            status: 'proposed',
          },
        ],
      }),
      true,
    );
    expect(result).toHaveLength(1001);
    expect(result.find((row) => row.requestId === id(1000))?.expectedAt).toBe('2026-12-01');
  });
  it('distinguishes an unavailable buyer case from a missing case', async () => {
    await expect(loadBuyerCase(database({}, 'requests'), 'request', true)).rejects.toThrow();
    expect(await loadBuyerCase(database({}), 'request', true)).toBeNull();
  });
  it('does not silently truncate request items in buyer case details', async () => {
    const result = await loadBuyerCase(
      database({
        requests: [{ id: 'request', status: 'submitted', updated_at: timestamp }],
        request_items: Array.from({ length: 1001 }, (_, n) => ({
          id: id(n),
          request_id: 'request',
          name: 'E2E item',
          created_at: timestamp,
        })),
      }),
      'request',
      true,
    );
    expect(result?.items).toHaveLength(1001);
  });
  it('does not suppress supplier payout failures as zero earnings', async () => {
    await expect(loadSupplierHome(database({}, 'supplier_payouts'), null)).rejects.toThrow();
  });
  it('sums all 1001 visible supplier payouts', async () => {
    const result = await loadSupplierHome(
      database({
        supplier_payouts: Array.from({ length: 1001 }, (_, n) => ({
          id: id(n),
          status: 'paid',
          amount_kzt: 10,
          created_at: timestamp,
        })),
      }),
      null,
    );
    expect(result.totalPayoutsKzt).toBe(10010);
  });
  for (const [name, load] of [
    ['buyer', loadBuyerThreads],
    ['supplier', loadSupplierThreads],
  ] as const) {
    it(`${name} previews count every unread message and preserve old quiet threads`, async () => {
      const threads = [
        { id: 'a', kind: name, orders: null },
        { id: 'b', kind: name, orders: null },
      ];
      const messages = Array.from({ length: 1001 }, (_, n) => ({
        id: id(n),
        thread_id: 'a',
        body: 'E2E recent',
        created_at: timestamp,
        author_user_id: 'other',
      }));
      messages.push({
        id: 'z',
        thread_id: 'b',
        body: 'E2E quiet',
        created_at: '2025-01-01',
        author_user_id: 'other',
      });
      const result = await load(database({ threads, messages }), 'self');
      expect(result.find((r) => r.id === 'a')?.unreadCount).toBe(1001);
      expect(result.find((r) => r.id === 'b')?.lastMessage).toBe('E2E quiet');
    });
    it(`${name} previews reject read-marker errors`, async () => {
      await expect(
        load(database({ threads: [{ id: 'a', kind: name }] }, 'thread_reads'), 'self'),
      ).rejects.toThrow();
    });
  }
  it('reads full message and attachment histories with deterministic chronological order', async () => {
    const messages = Array.from({ length: 1001 }, (_, n) => ({
      id: id(n),
      thread_id: 'a',
      created_at: timestamp,
      body: 'E2E',
      author_user_id: 'self',
    }));
    const client = database({
      messages,
      attachments: messages.map((r) => ({
        ...r,
        file_name: 'E2E.pdf',
        content_type: 'application/pdf',
        size_bytes: 1,
      })),
    });
    expect(await loadThreadMessages(client, 'a', 'self')).toHaveLength(1001);
    expect(await loadThreadAttachments(client, 'a')).toHaveLength(1001);
  });
});
