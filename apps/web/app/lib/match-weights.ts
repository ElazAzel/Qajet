import { DEFAULT_WEIGHTS, type MatchWeights } from '@qajet/engine/match';

/**
 * Какие веса подбора применять при рассылке RFQ.
 *
 * Контур обучения (`recalibration.ts`) пересчитывает веса при закрытии каждого
 * заказа и пишет снапшот. Применять их с первого же заказа нельзя, и дело не в
 * осторожности вообще, а в устройстве данных: один закрытый заказ даёт
 * наблюдение на КАЖДЫЙ разосланный RFQ — обычно 10–15 штук, — из которых
 * побеждают один-два. Остальные получают цель 0. Значит подавляющее
 * большинство шагов градиентного спуска тянет веса вниз, и за несколько
 * заказов модель смещается в сторону «никто не выигрывает». Ранжирование от
 * этого не улучшается, а портится.
 *
 * Поэтому запись и применение разделены: снапшоты пишутся всегда (данные не
 * теряются и видны в админке), а применяются только после того, как накопится
 * достаточно закрытых заказов. До этого работают стартовые веса — то же
 * поведение, что было до подключения обучения.
 *
 * Порог задан в ЗАКАЗАХ, а не в строках наблюдений: «тридцать закрытых
 * заказов» можно проверить глазами, «триста шестьдесят наблюдений» — нет.
 */
export const MIN_CLOSED_ORDERS_BEFORE_LEARNED_WEIGHTS = 30;

const FEATURE_KEYS: readonly (keyof MatchWeights)[] = [
  'categoryMatch',
  'onTimeRate',
  'noDisputeRate',
  'responseSpeedScore',
  'winRate',
  'freshnessScore',
  'currentLoad',
];

/**
 * Снапшот приходит из базы как JSON: его форма ничем не гарантирована, а
 * неполный или нечисловой набор весов молча исказил бы рассылку.
 */
function isCompleteWeights(value: MatchWeights | null | undefined): value is MatchWeights {
  if (!value || typeof value !== 'object') return false;
  return FEATURE_KEYS.every((key) =>
    Number.isFinite((value as unknown as Record<string, unknown>)[key]),
  );
}

export interface DispatchWeights {
  weights: MatchWeights;
  /** Применены ли обученные веса. Ложь означает стартовые — это не ошибка. */
  learned: boolean;
}

export function weightsForDispatch(
  learnedWeights: MatchWeights | null | undefined,
  closedOrdersLearnedFrom: number,
): DispatchWeights {
  if (closedOrdersLearnedFrom < MIN_CLOSED_ORDERS_BEFORE_LEARNED_WEIGHTS) {
    return { weights: DEFAULT_WEIGHTS, learned: false };
  }
  if (!isCompleteWeights(learnedWeights)) {
    return { weights: DEFAULT_WEIGHTS, learned: false };
  }
  return { weights: learnedWeights, learned: true };
}
