/**
 * Напоминания поставщику в WhatsApp — без интеграции с Meta.
 *
 * Консьерж нажимает ссылку `wa.me`, WhatsApp открывается с готовым текстом, он
 * отправляет его сам. Это работает с первого дня: не нужны верификация бизнеса в
 * Meta, одобренные шаблоны и оплата за сообщения. Автоматическая отправка через
 * WhatsApp Business Platform — следующий шаг, когда объём оправдает эти расходы
 * (docs/product/growth-and-matching-strategy.md).
 */

/** Приводит казахстанский номер к +7XXXXXXXXXX или возвращает null. */
export function normalizeKzPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  // С плюсом человек уже написал код страны: «+7701123456» — это +7 и девять цифр,
  // а не десятизначный местный номер.
  const international = input.trim().startsWith('+');
  let national: string | null = null;
  if (digits.length === 10 && !international) national = digits;
  else if (
    digits.length === 11 &&
    (digits.startsWith('7') || (!international && digits.startsWith('8')))
  ) {
    national = digits.slice(1);
  }
  return national ? `+7${national}` : null;
}

/** Ссылка на чат с готовым текстом. `phone` — уже в формате +7XXXXXXXXXX. */
export function whatsappChatUrl(phone: string, text: string): string {
  return `https://wa.me/${phone.replace(/^\+/, '')}?text=${encodeURIComponent(text)}`;
}

export function buildRfqReminderText(input: {
  requestTitle: string;
  respondBy: string | null;
  rfqUrl: string;
}): string {
  const deadline = input.respondBy
    ? ` до ${new Date(input.respondBy).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'Asia/Almaty' })}`
    : '';
  return `Здравствуйте! Это QAJET. Ждём ваш ответ на запрос «${input.requestTitle}»${deadline}. Цена и срок — по ссылке: ${input.rfqUrl}`;
}
