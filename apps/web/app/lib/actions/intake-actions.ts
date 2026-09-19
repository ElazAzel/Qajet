'use server';

import { type ParsedRequestDraft, parseRequestText } from '@qajet/engine/intake';
import { z } from 'zod';
import { CATALOG } from '../catalog';
import { requireCurrentUser } from '../current-user';

/**
 * Серверный разбор свободного текста заявки — qajet-master-spec.md §8A.
 *
 * Вся логика живёт в `@qajet/engine/intake` (чистые функции, без сети):
 * `itemClauses()` режет текст на позиции, `nomenclatureText()` убирает
 * количество/срок/валюту перед сравнением с каталогом — без этого
 * триграммы и Дамерау-Левенштейн занижают сходство просто из-за длины
 * строки, а не из-за реального несовпадения позиции.
 *
 * Результат — всегда превью с `needsClarification` на каждое поле ниже
 * порога уверенности. Ничего не подставляется в форму молча: решение
 * добавить позицию принимает человек.
 */

const quickTextSchema = z.string().trim().min(1).max(5000);

/** Полный серверный preview заявки: несколько позиций и общие поля. */
export async function parseRequestTextAction(text: string): Promise<ParsedRequestDraft> {
  await requireCurrentUser();
  const parsedText = quickTextSchema.safeParse(text);
  if (!parsedText.success) {
    return parseRequestText('', [], new Date());
  }
  return parseRequestText(
    parsedText.data,
    CATALOG.map((item) => ({
      key: item.itemKey,
      label: item.name,
      category: item.category,
      unit: item.unit,
      qtyMin: item.qtyMin,
      qtyMax: item.qtyMax,
      requiredCapabilities: item.requiredCapabilities,
    })),
    new Date(),
  );
}
