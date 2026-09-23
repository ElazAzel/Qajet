import { describe, expect, it } from 'vitest';
import { formatBoardDeadline } from './board-row';
import { almatyToday } from './dates';
import { ORDER_TURN } from './order-state';

/**
 * Строка доски консьержа должна отвечать на утренний вопрос: что просрочено и
 * у кого мяч (аудит F6). Обе величины считаются здесь, без обращения к базе.
 */

describe('formatBoardDeadline', () => {
  const today = '2026-09-20';

  it('просроченный срок называет число дней и помечается как просрочка', () => {
    const result = formatBoardDeadline('2026-09-17', today);
    expect(result.overdue).toBe(true);
    // Смысл несёт слово, а не только цвет: иначе просрочку не увидит тот,
    // кто не различает цвета, и экранный читатель.
    expect(result.text).toContain('просрочено');
    expect(result.text).toContain('3');
  });

  it('сегодняшний срок — ещё не просрочка', () => {
    const result = formatBoardDeadline(today, today);
    expect(result.overdue).toBe(false);
    expect(result.text).toContain('сегодня');
  });

  it('будущий срок показывает дату и запас', () => {
    const result = formatBoardDeadline('2026-09-25', today);
    expect(result.overdue).toBe(false);
    expect(result.text).toContain('5');
  });

  it('отсутствие срока названо прямо, а не пустой строкой', () => {
    const result = formatBoardDeadline(null, today);
    expect(result.overdue).toBe(false);
    expect(result.text).toBe('срок не указан');
  });

  it('сравнение не зависит от часового пояса запускающего', () => {
    // deadline_date — это DATE. При сравнении через локальную полночь в UTC+5
    // вчерашний срок выглядел бы сегодняшним. Обе даты разбираются по частям.
    expect(formatBoardDeadline('2026-09-19', '2026-09-20').overdue).toBe(true);
    expect(formatBoardDeadline('2026-09-20', '2026-09-20').overdue).toBe(false);
    expect(formatBoardDeadline('2026-01-01', '2025-12-31').overdue).toBe(false);
  });

  it('«сегодня» — это сегодня в Алматы, а не на сервере в UTC', () => {
    // 01:00 25 сентября в Алматы — в UTC ещё 24-е.
    const result = formatBoardDeadline('2026-09-25', almatyToday(new Date('2026-09-24T20:00:00Z')));
    expect(result.text).toBe('срок сегодня');
  });
});

describe('ORDER_TURN', () => {
  it('описывает каждое состояние заказа', () => {
    // Полнота важнее содержания: пропущенное состояние дало бы пустую строку
    // ровно там, где консьерж ищет ответ.
    for (const state of Object.keys(ORDER_TURN)) {
      expect(ORDER_TURN[state as keyof typeof ORDER_TURN].label.length).toBeGreaterThan(0);
    }
    expect(Object.keys(ORDER_TURN)).toHaveLength(17);
  });

  it('ход у того, КОГО ждут, а не у того, кто выполняет переход', () => {
    // На «Оценён» переход совершает сотрудник, но ждём мы оплату клиента.
    expect(ORDER_TURN.estimated.side).toBe('buyer');
    // На «RFQ отправлен» ждём поставщиков.
    expect(ORDER_TURN.rfq_sent.side).toBe('supplier');
    // На «КП получены» мяч у QAJET: собрать план.
    expect(ORDER_TURN.quotes_received.side).toBe('qajet');
  });
});
