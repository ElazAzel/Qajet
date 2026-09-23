import { describe, expect, it } from 'vitest';
import { buildRfqReminderText, normalizeKzPhone, whatsappChatUrl } from './whatsapp';

describe('normalizeKzPhone', () => {
  it('accepts the ways people write a Kazakhstan mobile number', () => {
    for (const input of [
      '+77011234567',
      '87011234567',
      '77011234567',
      '+7 (701) 123-45-67',
      '8 701 123 45 67',
      ' 7011234567 ',
    ]) {
      expect(normalizeKzPhone(input), input).toBe('+77011234567');
    }
  });

  it('refuses what is not a +7 number of the right length', () => {
    for (const input of ['', '123', '+1 212 555 0100', '+7701123456', '+770112345678', 'abc']) {
      expect(normalizeKzPhone(input), input).toBeNull();
    }
  });
});

describe('whatsappChatUrl', () => {
  it('opens a chat with the number and a prefilled, encoded message', () => {
    expect(whatsappChatUrl('+77011234567', 'Здравствуйте & до встречи')).toBe(
      'https://wa.me/77011234567?text=%D0%97%D0%B4%D1%80%D0%B0%D0%B2%D1%81%D1%82%D0%B2%D1%83%D0%B9%D1%82%D0%B5%20%26%20%D0%B4%D0%BE%20%D0%B2%D1%81%D1%82%D1%80%D0%B5%D1%87%D0%B8',
    );
  });
});

describe('buildRfqReminderText', () => {
  it('names the request, the deadline and where to answer', () => {
    const text = buildRfqReminderText({
      requestTitle: 'Худи с логотипом',
      respondBy: '2026-09-25T12:00:00Z',
      rfqUrl: 'https://qajet-seven.vercel.app/supplier/rfq/abc',
    });
    expect(text).toContain('QAJET');
    expect(text).toContain('«Худи с логотипом»');
    expect(text).toContain('25 сент.');
    expect(text).toContain('https://qajet-seven.vercel.app/supplier/rfq/abc');
  });

  it('does not invent a deadline when there is none', () => {
    const text = buildRfqReminderText({ requestTitle: 'X', respondBy: null, rfqUrl: '/supplier' });
    expect(text).not.toContain('до ');
  });
});
