import { describe, expect, it } from 'vitest';
import { pickLatestQuoteByRfq } from './latest-quote';

/**
 * Правило выбора версии КП закреплено тестом, потому что на него теперь опираются
 * три экрана. Молчаливое изменение порядка разведёт их показания.
 */

const quote = (id: string, rfq_id: string, version: number, submitted_at: string) => ({
  id,
  rfq_id,
  version,
  submitted_at,
});

describe('pickLatestQuoteByRfq', () => {
  it('берёт наибольший номер версии, а не последнюю строку ответа', () => {
    const latest = pickLatestQuoteByRfq([
      quote('q2', 'rfq-1', 2, '2026-09-01T10:00:00Z'),
      quote('q1', 'rfq-1', 1, '2026-09-02T10:00:00Z'),
    ]);
    expect(latest.get('rfq-1')?.id).toBe('q2');
  });

  it('при равных версиях берёт более позднюю отправку', () => {
    const latest = pickLatestQuoteByRfq([
      quote('qa', 'rfq-1', 1, '2026-09-01T10:00:00Z'),
      quote('qb', 'rfq-1', 1, '2026-09-01T12:00:00Z'),
    ]);
    expect(latest.get('rfq-1')?.id).toBe('qb');
  });

  it('при полностью равных версии и времени разрывает ничью по идентификатору', () => {
    // Внутри одной транзакции now() одинаков, поэтому этот случай реален.
    const sameMoment = '2026-09-01T10:00:00Z';
    const forward = pickLatestQuoteByRfq([
      quote('aaa', 'rfq-1', 1, sameMoment),
      quote('bbb', 'rfq-1', 1, sameMoment),
    ]);
    const reversed = pickLatestQuoteByRfq([
      quote('bbb', 'rfq-1', 1, sameMoment),
      quote('aaa', 'rfq-1', 1, sameMoment),
    ]);
    expect(forward.get('rfq-1')?.id).toBe('bbb');
    expect(reversed.get('rfq-1')?.id, 'выбор не должен зависеть от порядка строк').toBe('bbb');
  });

  it('разделяет разные RFQ', () => {
    const latest = pickLatestQuoteByRfq([
      quote('q1', 'rfq-1', 3, '2026-09-01T10:00:00Z'),
      quote('q2', 'rfq-2', 1, '2026-09-01T10:00:00Z'),
    ]);
    expect(latest.size).toBe(2);
    expect(latest.get('rfq-2')?.id).toBe('q2');
  });

  it('пустой и отсутствующий список дают пустую карту', () => {
    expect(pickLatestQuoteByRfq([]).size).toBe(0);
    expect(pickLatestQuoteByRfq(null).size).toBe(0);
    expect(pickLatestQuoteByRfq(undefined).size).toBe(0);
  });
});
