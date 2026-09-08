import { env, pipeline } from '@huggingface/transformers';
import { EMBEDDINGS_CACHE_DIR } from './paths.js';

/**
 * Локальные эмбеддинги для векторного слоя RAG (ADR-0004, «что осталось»).
 * `@huggingface/transformers` — ONNX Runtime в Node, без единого внешнего
 * API-ключа (agents.md §2): модель скачивается один раз с huggingface.co
 * (обычный HTTPS, не требует токена для публичных моделей) и кэшируется
 * локально в `tools/rag/.cache/` (не коммитится, см. .gitignore).
 *
 * Модель — `Xenova/paraphrase-multilingual-MiniLM-L12-v2` (XLM-R база,
 * ~50 языков, включая русский и казахский — agents.md требует RU/KZ/EN)
 * в q8-квантованном виде (~130 МБ вместо ~465 МБ fp32 — проверено в этой
 * сессии, `dtype: 'q8'` даёт практически ту же точность ранжирования при
 * трети веса). 384-мерный вектор, mean pooling + L2-нормализация — так
 * косинусное расстояние совпадает с обычным евклидовым, которое считает
 * `sqlite-vec` по умолчанию.
 */

env.cacheDir = EMBEDDINGS_CACHE_DIR;

const MODEL_ID = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
export const EMBEDDING_DIMENSIONS = 384;

interface FeatureExtractionOutput {
  data: Float32Array | number[];
}

type FeatureExtractor = (
  text: string,
  options: { pooling: 'mean'; normalize: true },
) => Promise<FeatureExtractionOutput>;

let extractorPromise: Promise<FeatureExtractor> | null = null;

/** Ленивая загрузка модели — тяжёлая (секунды), нужна не для каждого вызова CLI (например `rag:log`). */
function getExtractor(): Promise<FeatureExtractor> {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', MODEL_ID, {
      dtype: 'q8',
    }) as unknown as Promise<FeatureExtractor>;
  }
  return extractorPromise;
}

export async function embedText(text: string): Promise<Float32Array> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return output.data instanceof Float32Array ? output.data : new Float32Array(output.data);
}

/**
 * Последовательно, не `Promise.all` — корпус небольшой (сотни секций), а
 * ONNX Runtime уже сам использует несколько потоков на один вызов;
 * параллельные вызовы конкурировали бы за тот же пул потоков без
 * ускорения, только с риском исчерпать память на модели такого размера.
 */
export async function embedBatch(texts: readonly string[]): Promise<Float32Array[]> {
  const results: Float32Array[] = [];
  for (const text of texts) {
    results.push(await embedText(text));
  }
  return results;
}
