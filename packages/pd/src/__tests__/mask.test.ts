import { describe, expect, it } from 'vitest';
import { maskPII, unmaskPII } from '../mask';

describe('maskPII', () => {
  it('маскирует известное имя и адрес по структурированным значениям', () => {
    const { masked, unmaskMap } = maskPII(
      'Заявка от Айгерим Сатпаевой, доставка на пр. Достык 5, офис 12.',
      [
        { type: 'name', value: 'Айгерим Сатпаевой' },
        { type: 'address', value: 'пр. Достык 5, офис 12' },
      ],
    );

    expect(masked.text).toBe('Заявка от EMPLOYEE_1, доставка на ADDRESS_1.');
    expect(unmaskMap.EMPLOYEE_1).toBe('Айгерим Сатпаевой');
    expect(unmaskMap.ADDRESS_1).toBe('пр. Достык 5, офис 12');
  });

  it('маскирует email и телефон в свободном тексте без знания заранее', () => {
    const { masked, unmaskMap } = maskPII(
      'Свяжитесь со мной по aigerim@nomadtech.kz или +7 701 234 56 78.',
    );

    expect(masked.text).toBe('Свяжитесь со мной по EMAIL_1 или PHONE_1.');
    expect(unmaskMap.EMAIL_1).toBe('aigerim@nomadtech.kz');
    expect(unmaskMap.PHONE_1).toBe('+7 701 234 56 78');
  });

  it('нумерует токены по порядку появления для нескольких сущностей одного типа', () => {
    const { masked, unmaskMap } = maskPII('Пишите на a@b.kz или на c@d.kz.');

    expect(masked.text).toBe('Пишите на EMAIL_1 или на EMAIL_2.');
    expect(unmaskMap.EMAIL_1).toBe('a@b.kz');
    expect(unmaskMap.EMAIL_2).toBe('c@d.kz');
  });

  it('не оставляет ПД в тексте после маскирования (весь известный набор типов)', () => {
    const { masked } = maskPII('Иван Иванов, ivan@qajet.kz, +7 700 111 22 33, ул. Абая 10', [
      { type: 'name', value: 'Иван Иванов' },
      { type: 'address', value: 'ул. Абая 10' },
    ]);

    expect(masked.text).not.toMatch(/Иван Иванов|ivan@qajet\.kz|\+7 700 111 22 33|ул\. Абая 10/);
  });

  it('возвращает MaskedPayload как непрозрачный тип с брендом', () => {
    const { masked } = maskPII('без ПД');
    expect(masked.__brand).toBe('MaskedPayload');
  });
});

describe('unmaskPII', () => {
  it('восстанавливает исходные значения по токенам из ответа модели', () => {
    const { masked, unmaskMap } = maskPII('Клиент Айгерим Сатпаева, aigerim@nomadtech.kz', [
      { type: 'name', value: 'Айгерим Сатпаева' },
    ]);

    // Имитация ответа внешней модели, которая оперирует только токенами.
    const modelResponse = `Резюме: клиент ${masked.text.match(/EMPLOYEE_\d+/)?.[0]} подтвердил заказ, контакт ${masked.text.match(/EMAIL_\d+/)?.[0]}.`;

    expect(unmaskPII(modelResponse, unmaskMap)).toBe(
      'Резюме: клиент Айгерим Сатпаева подтвердил заказ, контакт aigerim@nomadtech.kz.',
    );
  });

  it('не трогает текст без токенов', () => {
    expect(unmaskPII('обычный текст без токенов', {})).toBe('обычный текст без токенов');
  });

  it('заменяет более длинные токены раньше коротких и не повреждает EMAIL_10', () => {
    expect(
      unmaskPII('EMAIL_1 и EMAIL_10', {
        EMAIL_1: 'short@example.kz',
        EMAIL_10: 'long@example.kz',
      }),
    ).toBe('short@example.kz и long@example.kz');
  });
});
