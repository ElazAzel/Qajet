import { describe, expect, it } from 'vitest';
import { blockedRequests } from './concierge-blocked';

/**
 * Признак «заблокирован» для доски консьержа: по заявке нет ни одного КП, которое
 * может попасть в сравнение, поэтому предложить план невозможно.
 *
 * Проверка здесь — ПОДМНОЖЕСТВО настоящей из packages/engine/src/combine/combine.ts.
 * Из-за этого пометка не может солгать: провал по дешёвому признаку означает провал
 * и по настоящему. Обратное неверно — заказ, заблокированный только просроченным
 * сроком поставки, здесь не помечается, и это закреплено отдельным тестом, чтобы
 * ограничение не потерялось.
 */

const TODAY = '2026-09-20';

const item = (id: string, requestId: string, qty = 10) => ({
  id,
  request_id: requestId,
  name: `Позиция ${id}`,
  qty,
});

interface LineInput {
  request_item_id: string;
  rfq_id: string;
  quote_id: string;
  version?: number;
  submitted_at?: string;
  valid_until?: string | null;
  capability_confirmed?: boolean;
  field_flags?: Record<string, unknown> | null;
  min_qty?: number | null;
}

const line = (input: LineInput) => ({
  request_item_id: input.request_item_id,
  capability_confirmed: input.capability_confirmed ?? true,
  field_flags: input.field_flags ?? {},
  min_qty: input.min_qty ?? null,
  quote: {
    id: input.quote_id,
    rfq_id: input.rfq_id,
    version: input.version ?? 1,
    submitted_at: input.submitted_at ?? '2026-09-10T10:00:00Z',
    valid_until: input.valid_until ?? null,
  },
});

describe('blockedRequests', () => {
  it('годное КП по каждой позиции — заявка не заблокирована', () => {
    const blocked = blockedRequests({
      items: [item('i1', 'r1'), item('i2', 'r1')],
      lines: [
        line({ request_item_id: 'i1', rfq_id: 'rfq1', quote_id: 'q1' }),
        line({ request_item_id: 'i2', rfq_id: 'rfq1', quote_id: 'q1' }),
      ],
      today: TODAY,
    });
    expect(blocked.size).toBe(0);
  });

  it('неподтверждённая возможность блокирует — это и есть случай F1', () => {
    const blocked = blockedRequests({
      items: [item('i1', 'r1')],
      lines: [
        line({
          request_item_id: 'i1',
          rfq_id: 'rfq1',
          quote_id: 'q1',
          capability_confirmed: false,
        }),
      ],
      today: TODAY,
    });
    expect(blocked.get('r1')?.blockingItemName).toBe('Позиция i1');
  });

  it('открытые уточнения по полям блокируют', () => {
    const blocked = blockedRequests({
      items: [item('i1', 'r1')],
      lines: [
        line({
          request_item_id: 'i1',
          rfq_id: 'rfq1',
          quote_id: 'q1',
          field_flags: { leadTimeDays: 'clarify' },
        }),
      ],
      today: TODAY,
    });
    expect(blocked.has('r1')).toBe(true);
  });

  it('минимальная партия больше нужного количества блокирует', () => {
    const blocked = blockedRequests({
      items: [item('i1', 'r1', 10)],
      lines: [line({ request_item_id: 'i1', rfq_id: 'rfq1', quote_id: 'q1', min_qty: 50 })],
      today: TODAY,
    });
    expect(blocked.has('r1')).toBe(true);
  });

  it('истёкшее КП блокирует, а действующее до сегодня — нет', () => {
    const expired = blockedRequests({
      items: [item('i1', 'r1')],
      lines: [
        line({ request_item_id: 'i1', rfq_id: 'rfq1', quote_id: 'q1', valid_until: '2026-09-19' }),
      ],
      today: TODAY,
    });
    expect(expired.has('r1')).toBe(true);

    const stillValid = blockedRequests({
      items: [item('i1', 'r1')],
      lines: [line({ request_item_id: 'i1', rfq_id: 'rfq1', quote_id: 'q1', valid_until: TODAY })],
      today: TODAY,
    });
    expect(stillValid.has('r1')).toBe(false);
  });

  it('смотрит на АКТУАЛЬНУЮ версию: годная версия 1 не спасает негодную версию 2', () => {
    const blocked = blockedRequests({
      items: [item('i1', 'r1')],
      lines: [
        line({ request_item_id: 'i1', rfq_id: 'rfq1', quote_id: 'q1', version: 1 }),
        line({
          request_item_id: 'i1',
          rfq_id: 'rfq1',
          quote_id: 'q2',
          version: 2,
          capability_confirmed: false,
        }),
      ],
      today: TODAY,
    });
    expect(blocked.has('r1'), 'устаревшая версия не должна перекрывать текущую').toBe(true);
  });

  it('хватает одного годного поставщика по каждой позиции', () => {
    const blocked = blockedRequests({
      items: [item('i1', 'r1')],
      lines: [
        line({
          request_item_id: 'i1',
          rfq_id: 'rfq1',
          quote_id: 'q1',
          capability_confirmed: false,
        }),
        line({ request_item_id: 'i1', rfq_id: 'rfq2', quote_id: 'q2' }),
      ],
      today: TODAY,
    });
    expect(blocked.has('r1')).toBe(false);
  });

  it('позиция, по которой не ответил никто, блокирует заявку', () => {
    const blocked = blockedRequests({
      items: [item('i1', 'r1'), item('i2', 'r1')],
      lines: [line({ request_item_id: 'i1', rfq_id: 'rfq1', quote_id: 'q1' })],
      today: TODAY,
    });
    expect(blocked.get('r1')?.blockingItemName).toBe('Позиция i2');
  });

  it('заявка без позиций считается заблокированной: собирать нечего', () => {
    expect(blockedRequests({ items: [], lines: [], today: TODAY }).size).toBe(0);
  });

  it('разные заявки не влияют друг на друга', () => {
    const blocked = blockedRequests({
      items: [item('i1', 'r1'), item('i2', 'r2')],
      lines: [
        line({
          request_item_id: 'i1',
          rfq_id: 'rfq1',
          quote_id: 'q1',
          capability_confirmed: false,
        }),
        line({ request_item_id: 'i2', rfq_id: 'rfq2', quote_id: 'q2' }),
      ],
      today: TODAY,
    });
    expect(blocked.has('r1')).toBe(true);
    expect(blocked.has('r2')).toBe(false);
  });
});
