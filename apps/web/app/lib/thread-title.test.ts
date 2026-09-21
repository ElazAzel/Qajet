import { describe, expect, it } from 'vitest';
import { threadTitle } from './thread-title';

/**
 * В списке переписок покупателя все строки назывались «Заказ» (аудит F5).
 * Причина не в оформлении: у треда есть И `order_id`, И `request_id`, а
 * загрузчик соединял только через заказы. Пока заявка не стала заказом,
 * связи нет — и заголовок падал в заглушку.
 *
 * Человек в этот момент видит несколько одинаковых строк и не может понять,
 * какая из них про какую закупку.
 */

describe('threadTitle', () => {
  it('берёт название заявки через заказ, когда заказ уже есть', () => {
    expect(
      threadTitle({
        orderRequestTitle: 'Welcome-наборы для новичков',
        ownRequestTitle: null,
      }),
    ).toBe('Welcome-наборы для новичков');
  });

  it('берёт название собственной заявки, когда заказа ещё нет', () => {
    // Ровно тот случай, из-за которого строки назывались «Заказ».
    expect(
      threadTitle({
        orderRequestTitle: null,
        ownRequestTitle: 'Полиграфия к конференции',
      }),
    ).toBe('Полиграфия к конференции');
  });

  it('заказ важнее: если известны оба, побеждает название через заказ', () => {
    expect(
      threadTitle({
        orderRequestTitle: 'Через заказ',
        ownRequestTitle: 'Через заявку',
      }),
    ).toBe('Через заказ');
  });

  it('когда названия нет вовсе, заглушка не притворяется заказом', () => {
    // «Заказ» как заглушка хуже пустоты: строка выглядит осмысленной,
    // а на деле не отличима от соседней.
    const fallback = threadTitle({ orderRequestTitle: null, ownRequestTitle: null });
    expect(fallback).not.toBe('Заказ');
    expect(fallback.length).toBeGreaterThan(0);
  });

  it('пустая строка и пробелы считаются отсутствием названия', () => {
    expect(threadTitle({ orderRequestTitle: '   ', ownRequestTitle: 'Настоящее' })).toBe(
      'Настоящее',
    );
  });
});
