'use server';

import {
  type AliasEntry,
  type CatalogEntry,
  extractBudget,
  extractDeadline,
  extractQuantity,
  matchNomenclature,
  normalizeText,
  resolveAlias,
} from '@qajet/engine/intake';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { CATALOG, CATEGORY_LABEL, type CatalogCategory } from '../catalog';
import { requireCurrentUser } from '../current-user';

/**
 * Быстрый разбор текста заявки — agents.md §8A, волна 1 шаг 5 («замыкание
 * контура»). Раньше `parseQuickText` жил целиком на клиенте
 * (buyer/requests/new/page.tsx) и не мог прочитать `extraction_aliases` —
 * RLS до этого шага была staffOnly. Теперь таблица открыта для всех
 * authenticated (packages/db/src/schema/learning.ts, комментарий там же),
 * поэтому разбор перенесён в server action — та же чистая логика
 * (`@qajet/engine/intake`), но с накопленными исправлениями консьержа.
 *
 * `resolveAlias()` здесь ТОЛЬКО подсказка в превью — не переопределяет
 * `request_items.category` при создании заявки. У каждой позиции каталога
 * `category` и `requiredCapabilities` — согласованная пара, по которой
 * `sendRfq` подбирает поставщиков нужной специализации; подменить одну
 * `category` алиасом означало бы риск отправить RFQ не тем поставщикам,
 * а как в этом случае синхронизировать `requiredCapabilities` — нигде не
 * специфицировано. Показ подсказки покупателю/консьержу — самостоятельно
 * ценная и безопасная часть эффекта, дальше решение всё равно за человеком.
 */

const CATALOG_ENTRIES: CatalogEntry[] = CATALOG.map((c) => ({ key: c.itemKey, label: c.name }));
const quickTextSchema = z.string().trim().min(1).max(5000);

// matchNomenclature (agents.md §8A) сравнивает строку целиком с коротким
// каталожным названием — «120 футболок с логотипом до 20 октября» против
// «Футболка с логотипом» триграммами/Дамерау-Левенштейном даёт заведомо
// заниженное сходство просто из-за длины строки, а не из-за реального
// несовпадения позиции. Убираем количество/срок/валюту перед сравнением
// номенклатуры — сам движок не трогаем, это исключительно подготовка
// текста для одного конкретного вызова здесь (перенесено сюда с клиента
// вместе с остальным разбором).
// Не \b: в JS-регулярках без юникодных классов Cyrillic не входит в \w,
// поэтому \b вокруг кириллических слов не срабатывает вовсе (граница
// требует, чтобы хотя бы одна сторона была \w). Явные lookaround вместо.
const NOISE_RE =
  /(?<![a-zа-яё])(\d[\d\s]*|шт\.?|штук|коробок|уп\.?|упаковок|компл\.?|комплектов|пар|наборов|до|к|через|дн(?:ей|я|ь)|недел[юия]|месяц[аеы]?|млн|тг|тенге|₸|января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?![a-zа-яё])/gi;

function stripNoiseForMatching(text: string): string {
  const stripped = text.replace(NOISE_RE, ' ').replace(/\s+/g, ' ').trim();
  return stripped || text;
}

export interface QuickParseResult {
  itemKey: string | null;
  itemLabel: string | null;
  itemConfidence: number;
  qty: number | null;
  deadline: string | null;
  budget: number | null;
  /** Категория из алиаса с hits ≥ порога, если она расходится с
   *  собственной категорией найденной каталожной позиции — только для
   *  показа, не для записи (см. комментарий в шапке файла). */
  categoryHint: { category: CatalogCategory; label: string } | null;
}

export async function parseQuickTextAction(text: string): Promise<QuickParseResult> {
  await requireCurrentUser();

  const parsedText = quickTextSchema.safeParse(text);
  if (!parsedText.success) {
    return {
      itemKey: null,
      itemLabel: null,
      itemConfidence: 0,
      qty: null,
      deadline: null,
      budget: null,
      categoryHint: null,
    };
  }
  const normalizedInput = parsedText.data;

  const supabase = await createSupabaseServerClient();
  const { data: aliasRows } = await supabase
    .from('extraction_aliases')
    .select('alias, canonical, kind, hits')
    .eq('kind', 'category');
  const aliases: AliasEntry[] = aliasRows ?? [];

  const nomenclature = matchNomenclature(stripNoiseForMatching(normalizedInput), CATALOG_ENTRIES);
  const quantity = extractQuantity(normalizedInput);
  const deadline = extractDeadline(normalizedInput, new Date());
  const budget = extractBudget(normalizedInput);

  // Ниже порога уверенности (agents.md §8A) — не подставляем молча, даже
  // если matchNomenclature вернул лучший кандидат: needsClarification уже
  // несёт этот сигнал, используем его, а не игнорируем ради удобства.
  const matchedItem =
    nomenclature.value && !nomenclature.needsClarification
      ? CATALOG.find((c) => c.itemKey === nomenclature.value)
      : null;

  const aliasCategory = resolveAlias(normalizeText(normalizedInput), aliases, 'category');
  const validCategory =
    aliasCategory && aliasCategory in CATEGORY_LABEL ? (aliasCategory as CatalogCategory) : null;
  const categoryHint =
    validCategory && validCategory !== matchedItem?.category
      ? { category: validCategory, label: CATEGORY_LABEL[validCategory] }
      : null;

  return {
    itemKey: matchedItem?.itemKey ?? null,
    itemLabel: matchedItem?.name ?? null,
    itemConfidence: nomenclature.confidence,
    qty: quantity.value?.qty ?? null,
    deadline: deadline.value,
    budget: budget.value,
    categoryHint,
  };
}
