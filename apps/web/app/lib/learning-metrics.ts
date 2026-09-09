import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Данные для /admin/learning (agents.md §8G, §10): «самый сильный слайд
 * для инвесторов, поэтому он должен быть реальным экраном с реальными
 * данными сида, а не картинкой». Источник — три модели в model_snapshots
 * (estimator/leadtime/matcher), которые пишет generate/reseed каждый
 * месяц истории, плюс rfqs.is_exploration для «новых поставщиков через
 * слоты исследования».
 */

interface EstimatorCategoryMetric {
  category: string;
  mape: number | null;
  marginPct: number;
}

export interface LearningPoint {
  trainedAt: string;
  avgMapePct: number | null;
  avgMarginPct: number;
  categoriesWithHistory: number;
  categoriesTotal: number;
}

export interface LeadtimePoint {
  trainedAt: string;
  nSuppliersWithHistory: number;
  nSamples: number;
}

export interface ExplorationPoint {
  month: string;
  count: number;
}

export interface AliasRow {
  id: string;
  alias: string;
  canonical: string;
  kind: string;
  hits: number;
  autoApplied: boolean;
}

export interface AliasMetrics {
  correctionsTotal: number;
  aliases: AliasRow[];
}

export interface LearningMetrics {
  estimator: LearningPoint[];
  leadtime: LeadtimePoint[];
  exploration: ExplorationPoint[];
  explorationSuppliersTotal: number;
}

/** hits ≥ 3 — порог, с которого agents.md §8A считает алиас применяемым
 *  автоматически (сегодня это только бейдж на экране, применяет его
 *  quick-add — шаг 5 волны 1). */
const AUTO_APPLY_HITS_THRESHOLD = 3;

/**
 * Видимость Classification Engine (agents.md §8A, волна 1 шаг 4) — сколько
 * раз концьерж поправил категорию (learning_events{type:'extraction_fix'})
 * и какие алиасы это уже накопило (extraction_aliases). Обе таблицы уже
 * staff-select (learning.ts) — RLS не меняется, чисто аддитивный шаг.
 */
export async function loadAliasMetrics(supabase: SupabaseClient): Promise<AliasMetrics> {
  const [{ count: correctionsTotal }, { data: aliasRows }] = await Promise.all([
    supabase
      .from('learning_events')
      .select('*', { count: 'exact', head: true })
      .eq('type', 'extraction_fix'),
    supabase
      .from('extraction_aliases')
      .select('id, alias, canonical, kind, hits')
      .order('hits', { ascending: false }),
  ]);

  const aliases: AliasRow[] = (aliasRows ?? []).map((a) => ({
    id: a.id,
    alias: a.alias,
    canonical: a.canonical,
    kind: a.kind,
    hits: a.hits,
    autoApplied: a.hits >= AUTO_APPLY_HITS_THRESHOLD,
  }));

  return { correctionsTotal: correctionsTotal ?? 0, aliases };
}

export async function loadLearningMetrics(supabase: SupabaseClient): Promise<LearningMetrics> {
  const { data: snapshots } = await supabase
    .from('model_snapshots')
    .select('model, metrics, trained_at, n_samples')
    .order('trained_at', { ascending: true });

  const estimator: LearningPoint[] = [];
  const leadtime: LeadtimePoint[] = [];

  for (const row of snapshots ?? []) {
    if (row.model === 'estimator') {
      const byCategory = (row.metrics?.byCategory ?? []) as EstimatorCategoryMetric[];
      const withMape = byCategory.filter((c) => c.mape !== null);
      const avgMapePct =
        withMape.length > 0
          ? (withMape.reduce((sum, c) => sum + (c.mape ?? 0), 0) / withMape.length) * 100
          : null;
      const avgMarginPct =
        byCategory.length > 0
          ? (byCategory.reduce((sum, c) => sum + c.marginPct, 0) / byCategory.length) * 100
          : 0;
      estimator.push({
        trainedAt: row.trained_at,
        avgMapePct,
        avgMarginPct,
        categoriesWithHistory: withMape.length,
        categoriesTotal: byCategory.length,
      });
    } else if (row.model === 'leadtime') {
      leadtime.push({
        trainedAt: row.trained_at,
        nSuppliersWithHistory: (row.metrics?.nSuppliersWithHistory as number) ?? 0,
        nSamples: row.n_samples,
      });
    }
  }

  const { data: explorationRows } = await supabase
    .from('rfqs')
    .select('sent_at, supplier_company_id')
    .eq('is_exploration', true)
    .order('sent_at', { ascending: true });

  const monthCounts = new Map<string, number>();
  const supplierIds = new Set<string>();
  for (const row of explorationRows ?? []) {
    const month = (row.sent_at as string).slice(0, 7);
    monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
    supplierIds.add(row.supplier_company_id);
  }
  const exploration = [...monthCounts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, count]) => ({ month, count }));

  return { estimator, leadtime, exploration, explorationSuppliersTotal: supplierIds.size };
}
