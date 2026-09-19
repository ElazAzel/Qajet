import 'server-only';

/**
 * Единственная точка серверного журнала сбоев — docs/architecture/
 * observability-design.md. Одна JSON-строка на сбой, связанная с тем, что
 * увидел пользователь, через `supportId`.
 *
 * Набор полей закрыт типом: свободного текста, тел заявок, email, SQL и
 * текста исходной ошибки здесь нет и быть не может. Исходный текст ошибки
 * пишется только в development — там он нужен разработчику, а персональных
 * данных боевых пользователей нет.
 */
export interface ActionFailureLog {
  supportId: string;
  /** `<модуль>.<действие>`, например `order.advanceOrderStage`. */
  operation: string;
  code: string;
  sqlstate?: string | undefined;
  errorName: string;
}

export function logActionFailure(entry: ActionFailureLog, raw?: unknown): void {
  try {
    const line: Record<string, string> = {
      level: 'error',
      event: 'action_failure',
      at: new Date().toISOString(),
      supportId: entry.supportId,
      operation: entry.operation,
      code: entry.code,
      errorName: entry.errorName,
    };
    if (entry.sqlstate) line.sqlstate = entry.sqlstate;
    if (process.env.NODE_ENV === 'development' && raw !== undefined) {
      line.devDetail =
        raw instanceof Error ? raw.message : String((raw as { message?: unknown })?.message ?? raw);
    }
    console.error(JSON.stringify(line));
  } catch {
    // fail-open: сбой журнала не должен ломать действие пользователя.
  }
}
