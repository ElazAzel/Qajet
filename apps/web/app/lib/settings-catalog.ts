import { COMMISSION_MAX_PCT, COMMISSION_MIN_PCT } from '@qajet/engine/commission';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Параметры экономики, которые админ правит вживую (agents.md §9). Белый
 * список, а не «любой ключ из settings»: та же таблица хранит
 * `qajet_requisites` (JSON реквизитов), и запись туда числа из формы
 * сломала бы счёт и акт.
 *
 * Границы — не украшение формы, а часть смысла параметра: комиссия вне
 * диапазона движка расходится с правилами, заданными для построчной правки
 * консьержем (`@qajet/engine/commission`), а нулевая ставка часа
 * превращает «вклад после прямых затрат» в комиссию и делает метрику
 * бессмысленной.
 */

export interface EditableSetting {
  key: string;
  label: string;
  hint: string;
  unit: string;
  min: number;
  max: number;
  step: number;
}

export const EDITABLE_SETTINGS: readonly EditableSetting[] = [
  {
    key: 'commission_rate_pct',
    label: 'Ставка комиссии',
    hint: `Начисляется поверх цены поставщика. Консьерж правит её по позиции в пределах ${COMMISSION_MIN_PCT}-${COMMISSION_MAX_PCT}%.`,
    unit: '%',
    min: COMMISSION_MIN_PCT,
    max: COMMISSION_MAX_PCT,
    step: 0.5,
  },
  {
    key: 'procurement_hour_cost_kzt',
    label: 'Стоимость часа закупщика',
    hint: 'Из неё считается полная стоимость обслуживания заказа и вклад после прямых затрат.',
    unit: '₸/ч',
    min: 0,
    max: 100_000,
    step: 500,
  },
  {
    key: 'cit_rate_pct',
    label: 'Ставка КПН',
    hint: 'Участвует в расчёте эффекта по вычету для поставщиков на упрощённой декларации (§11.4).',
    unit: '%',
    min: 0,
    max: 50,
    step: 1,
  },
  {
    key: 'rfq_batch_size_per_item',
    label: 'Поставщиков в рассылке RFQ',
    hint: 'Сколько лучших по скору поставщиков получают запрос на каждую позицию.',
    unit: 'шт',
    min: 1,
    max: 20,
    step: 1,
  },
  {
    key: 'rfq_exploration_every_n',
    label: 'Слот исследования — каждый N-й',
    hint: 'Как часто в рассылку добавляется поставщик без истории, чтобы сеть росла (§16.1).',
    unit: '',
    min: 1,
    max: 20,
    step: 1,
  },
  {
    key: 'logistics_buffer_days_almaty',
    label: 'Буфер логистики, Алматы',
    hint: 'Добавляется к сроку поставщика при прогнозе даты готовности.',
    unit: 'дн.',
    min: 0,
    max: 14,
    step: 1,
  },
  {
    key: 'logistics_buffer_days_intercity',
    label: 'Буфер логистики, межгород',
    hint: 'То же для поставщиков из других городов.',
    unit: 'дн.',
    min: 0,
    max: 30,
    step: 1,
  },
  {
    key: 'logistics_delivery_kzt_local',
    label: 'Доставка внутри города',
    hint: 'Фиксированный тариф локальной доставки, отдельно от базы комиссии.',
    unit: '₸',
    min: 0,
    max: 2_000_000,
    step: 1_000,
  },
  {
    key: 'logistics_delivery_kzt_intercity',
    label: 'Доставка между городами',
    hint: 'Фиксированный тариф межгородской доставки, отдельно от базы комиссии.',
    unit: '₸',
    min: 0,
    max: 5_000_000,
    step: 1_000,
  },
];

export interface SettingValue extends EditableSetting {
  value: number | null;
  updatedAt: string | null;
}

export async function loadEditableSettings(supabase: SupabaseClient): Promise<SettingValue[]> {
  const { data } = await supabase
    .from('settings')
    .select('key, value, updated_at')
    .in(
      'key',
      EDITABLE_SETTINGS.map((s) => s.key),
    );

  const byKey = new Map((data ?? []).map((row) => [row.key, row]));
  return EDITABLE_SETTINGS.map((definition) => {
    const row = byKey.get(definition.key);
    return {
      ...definition,
      value: typeof row?.value === 'number' ? row.value : null,
      updatedAt: row?.updated_at ?? null,
    };
  });
}
