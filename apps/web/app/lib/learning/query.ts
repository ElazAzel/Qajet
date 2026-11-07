/** Safe operation identifiers only: never retain a database/transport error. */
export class LearningOperationError extends Error {
  constructor(code: `learning.${string}`) {
    super(code);
    this.name = 'LearningOperationError';
  }
}

/** PostgREST failures usually resolve, rather than reject, their thenable. */
export async function checkedLearningQuery<T extends { error: unknown }>(
  query: PromiseLike<T>,
  code: `learning.${string}`,
): Promise<T> {
  try {
    const result = await query;
    if (result.error) throw new LearningOperationError(code);
    return result;
  } catch {
    // A rejected transport can contain confidential payloads too. Do not attach
    // its message or cause to the safe error returned to the dispatcher/UI.
    throw new LearningOperationError(code);
  }
}

export function learningFailureCode(error: unknown): string {
  return error instanceof LearningOperationError ? error.message : 'learning.processing';
}
