import { describe, expect, it } from 'vitest';
import { findSilentRfqs, type RfqContactRow } from './silent-suppliers';

const NOW = new Date('2026-09-23T12:00:00Z');
const HOUR = 3_600_000;

function rfq(overrides: Partial<RfqContactRow>): RfqContactRow {
  return {
    id: 'rfq-1',
    requestId: 'req-1',
    supplierName: 'Принт-Сервис',
    status: 'sent',
    sentAt: new Date(NOW.getTime() - 2 * HOUR).toISOString(),
    respondBy: new Date(NOW.getTime() + 72 * HOUR).toISOString(),
    ...overrides,
  };
}

/**
 * Поставщики не следят за сайтом (у них мало заказов от QAJET), поэтому молчание
 * до срока — повод консьержу связаться напрямую, а не ждать, пока RFQ истечёт.
 */
describe('findSilentRfqs', () => {
  it('does not flag a fresh RFQ far from its deadline', () => {
    expect(findSilentRfqs([rfq({})], NOW)).toEqual([]);
  });

  it('flags an unanswered RFQ within 24 hours of its deadline', () => {
    const row = rfq({ respondBy: new Date(NOW.getTime() + 20 * HOUR).toISOString() });
    expect(findSilentRfqs([row], NOW).map((r) => r.id)).toEqual(['rfq-1']);
  });

  it('flags an unanswered RFQ whose deadline has passed', () => {
    const row = rfq({ respondBy: new Date(NOW.getTime() - 1 * HOUR).toISOString() });
    expect(findSilentRfqs([row], NOW).map((r) => r.id)).toEqual(['rfq-1']);
  });

  it('never flags an RFQ the supplier already answered in any way', () => {
    const due = new Date(NOW.getTime() - 1 * HOUR).toISOString();
    const rows = (['quick_responded', 'quoted', 'declined', 'expired'] as const).map((status) =>
      rfq({ id: status, status, respondBy: due }),
    );
    expect(findSilentRfqs(rows, NOW)).toEqual([]);
  });

  it('flags an RFQ without a deadline after 48 hours of silence', () => {
    const young = rfq({
      id: 'young',
      respondBy: null,
      sentAt: new Date(NOW.getTime() - 47 * HOUR).toISOString(),
    });
    const old = rfq({
      id: 'old',
      respondBy: null,
      sentAt: new Date(NOW.getTime() - 49 * HOUR).toISOString(),
    });
    expect(findSilentRfqs([young, old], NOW).map((r) => r.id)).toEqual(['old']);
  });

  it('orders the most urgent first', () => {
    const later = rfq({
      id: 'later',
      respondBy: new Date(NOW.getTime() + 10 * HOUR).toISOString(),
    });
    const sooner = rfq({
      id: 'sooner',
      respondBy: new Date(NOW.getTime() + 2 * HOUR).toISOString(),
    });
    expect(findSilentRfqs([later, sooner], NOW).map((r) => r.id)).toEqual(['sooner', 'later']);
  });
});
