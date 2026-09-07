/**
 * Общий контракт "раскрытия" числа — agents.md §8: «Ни один экран не
 * показывает число без возможности раскрыть, из чего оно собрано.»
 * Каждый модуль движка, возвращающий денежную или иную значимую величину,
 * обязан вернуть explanation в этой форме — экран сравнения (§12) рендерит
 * decomposition построчно, без интерпретации на клиенте.
 */

export interface ExplanationLine {
  label: string;
  amountKzt?: number;
}

export interface Explanation {
  decomposition: ExplanationLine[];
  notes: string[];
}
