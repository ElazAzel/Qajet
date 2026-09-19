import { describe, expect, it } from 'vitest';
import {
  firstFieldWithError,
  isDeadlineInPast,
  REQUEST_FIELD_ORDER,
  requestFieldErrors,
} from './request-validation';

describe('requestFieldErrors', () => {
  it('называет конкретное поле и оставляет первое сообщение', () => {
    const errors = requestFieldErrors([
      { path: ['title'] },
      { path: ['title'] },
      { path: ['city'] },
      { path: ['items'] },
    ]);
    expect(errors).toEqual({
      title: 'Введите название заявки',
      city: 'Укажите город доставки',
      items: 'Добавьте хотя бы одну позицию',
    });
  });

  it('отличает ошибку количества позиции от пустого списка', () => {
    expect(requestFieldErrors([{ path: ['items', 0, 'qty'] }]).items).toBe(
      'Количество должно быть целым числом больше нуля',
    );
    expect(requestFieldErrors([{ path: ['items'] }]).items).toBe('Добавьте хотя бы одну позицию');
  });

  it('игнорирует неизвестные пути, чтобы не показывать пользователю внутренние имена', () => {
    expect(requestFieldErrors([{ path: ['__proto__'] }, { path: [] }, { path: ['nope'] }])).toEqual(
      {},
    );
  });
});

describe('firstFieldWithError', () => {
  it('выбирает верхнее по странице поле', () => {
    expect(firstFieldWithError({ budgetKzt: 'x', city: 'y' })).toBe('city');
    expect(firstFieldWithError({})).toBeNull();
  });

  it('порядок полей покрывает все поля сообщений', () => {
    expect(new Set(REQUEST_FIELD_ORDER).size).toBe(7);
  });
});

describe('isDeadlineInPast', () => {
  it('считает сегодняшнюю дату по Алматы допустимой, вчерашнюю — нет', () => {
    // 2026-09-19 22:00 UTC = 2026-09-20 03:00 в Алматы
    const now = new Date('2026-09-19T22:00:00Z');
    expect(isDeadlineInPast('2026-09-20', now)).toBe(false);
    expect(isDeadlineInPast('2026-09-19', now)).toBe(true);
    expect(isDeadlineInPast('2026-10-01', now)).toBe(false);
  });
});
