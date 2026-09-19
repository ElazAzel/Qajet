import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { actionFailure, classifyError, cleanBusinessMessage } = await import('./action-result');

function pgError(code: string, message: string, details = '') {
  return { code, message, details, hint: '' };
}

describe('actionFailure', () => {
  let logged: string[];
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    logged = [];
    vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      logged.push(String(line));
    });
    vi.stubEnv('NODE_ENV', 'production');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    expect(process.env.NODE_ENV).toBe(originalEnv);
  });

  it('показывает бизнес-отказ из RPC как есть и не заводит supportId', () => {
    const result = actionFailure(
      'order.advanceOrderException',
      pgError('P0001', 'Для паузы, отмены или спора нужна причина от 5 до 2000 символов'),
    );
    expect(result).toEqual({
      ok: false,
      code: 'rejected',
      error: 'Для паузы, отмены или спора нужна причина от 5 до 2000 символов',
    });
    expect(logged).toHaveLength(0);
  });

  it('снимает технический префикс имени функции у бизнес-сообщения', () => {
    const result = actionFailure(
      'team.setAccess',
      pgError('P0001', 'set_team_member_access: доступно только владельцу компании'),
    );
    expect(result.error).toBe('Доступно только владельцу компании');
  });

  it('авторский RAISE с ERRCODE 23514 — бизнес-отказ, а текст самого Postgres о CHECK — нет', () => {
    expect(actionFailure('x', pgError('23514', 'Нужна причина')).code).toBe('rejected');
    const raw = actionFailure(
      'x',
      pgError(
        '23514',
        'new row for relation "orders" violates check constraint "orders_total_check"',
      ),
    );
    expect(raw.code).toBe('internal');
    expect(raw.error).not.toContain('orders_total_check');
    expect(raw.supportId).toMatch(/^[0-9A-F]{8}$/);
  });

  it('нарушение RLS превращается в «недостаточно прав» и попадает в журнал', () => {
    const result = actionFailure(
      'change.resolve',
      pgError('42501', 'new row violates row-level security policy for table "change_requests"'),
    );
    expect(result.code).toBe('forbidden');
    expect(result.error).toMatch(
      /^Недостаточно прав для этого действия\. Код обращения: [0-9A-F]{8}\.$/,
    );
    expect(result.error).not.toContain('change_requests');
    expect(logged).toHaveLength(1);
    const line = JSON.parse(logged[0] as string);
    expect(line).toMatchObject({
      event: 'action_failure',
      operation: 'change.resolve',
      code: 'forbidden',
      sqlstate: '42501',
      supportId: result.supportId,
    });
  });

  it('не выпускает персональные данные из деталей ни пользователю, ни в production-журнал', () => {
    const err = pgError(
      '23505',
      'duplicate key value violates unique constraint "users_email_key"',
      'Key (email)=(aigerim@example.kz) already exists.',
    );
    const result = actionFailure('team.invite', err, 'Не удалось создать приглашение');
    expect(result.code).toBe('conflict');
    expect(JSON.stringify(result)).not.toMatch(/aigerim|users_email_key/);
    expect(logged.join('\n')).not.toMatch(/aigerim|users_email_key|duplicate key/);
  });

  it('неизвестный сбой использует переданную формулировку и код обращения', () => {
    const result = actionFailure(
      'attachment.upload',
      new TypeError('fetch failed'),
      'Не удалось загрузить файл',
    );
    expect(result.error).toMatch(/^Не удалось загрузить файл\. Код обращения: [0-9A-F]{8}\.$/);
    expect(result.error).not.toContain('fetch failed');
  });

  it('пустая ошибка при отсутствующей строке — это результат, а не сбой', () => {
    expect(actionFailure('request.load', null, 'Запрос не найден')).toEqual({
      ok: false,
      code: 'failed',
      error: 'Запрос не найден',
    });
    expect(logged).toHaveLength(0);
  });

  it('исходный текст ошибки попадает в журнал только в development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    actionFailure('x', new Error('socket hang up'));
    expect(JSON.parse(logged[0] as string).devDetail).toBe('socket hang up');
  });

  it('сбой журнала не ломает действие', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('stderr closed');
    });
    const result = actionFailure('x', new Error('boom'));
    expect(result.ok).toBe(false);
    expect(result.supportId).toBeDefined();
  });
});

describe('classifyError', () => {
  it('PGRST116 — запись не найдена', () => {
    expect(
      classifyError(pgError('PGRST116', 'JSON object requested, multiple (or no) rows returned'))
        .code,
    ).toBe('not_found');
  });

  it('конфликт сериализации и занятую блокировку считает конфликтом', () => {
    expect(classifyError(pgError('40001', 'could not serialize access')).code).toBe('conflict');
    expect(classifyError(pgError('55P03', 'could not obtain lock')).code).toBe('conflict');
  });
});

describe('cleanBusinessMessage', () => {
  it('не ломает сообщение без префикса и пустую строку', () => {
    expect(cleanBusinessMessage('По заказу уже есть запрос на рассмотрении')).toBe(
      'По заказу уже есть запрос на рассмотрении',
    );
    expect(cleanBusinessMessage('')).toBe('Не удалось выполнить действие.');
  });
});
