import { describe, expect, it } from 'vitest';
import { createAttachmentObjectKey, SupabaseStorageAdapter, safeStorageName } from './adapter';

/**
 * Supabase Storage отвечает `Invalid key` на ключ с кириллицей и на многие
 * символы (проверено на локальном стеке: `probe.txt` и `a b.txt` проходят,
 * `отчёт.txt`, `Отчёт-№1.txt`, `файл (1).txt` — нет). Продукт русскоязычный, а
 * ключ строился из имени файла с любыми буквами Unicode, поэтому вложение с
 * русским именем не загружалось вовсе и пользователь видел общую ошибку.
 *
 * Отображаемое имя хранится отдельно в `attachments.file_name`; ключ объекта
 * обязан быть безопасным ASCII, с сохранённым расширением.
 */
const SAFE_KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}-[A-Za-z0-9._-]+$/;

describe('createAttachmentObjectKey', () => {
  const user = '11111111-1111-4111-8111-111111111111';

  it.each([
    'Отчёт.pdf',
    'Отчёт №1.pdf',
    'файл (1).txt',
    'договор_поставки.docx',
    'Қазақша құжат.xlsx',
    'a b.txt',
    'probe.txt',
    '<img src=x onerror=alert(1)>.txt',
    '../../etc/passwd',
    'имя с "кавычками" и \'апострофом\'.png',
  ])('%s → безопасный ASCII-ключ', (name) => {
    expect(createAttachmentObjectKey(user, name)).toMatch(SAFE_KEY);
  });

  it('расширение сохраняется, чтобы файл открывался нужной программой', () => {
    expect(createAttachmentObjectKey(user, 'Отчёт №1.PDF')).toMatch(/\.pdf$/);
    expect(createAttachmentObjectKey(user, 'договор.docx')).toMatch(/\.docx$/);
    expect(createAttachmentObjectKey(user, 'a b.txt')).toMatch(/\.txt$/);
  });

  it('имя целиком из не-ASCII не даёт пустого ключа', () => {
    const key = createAttachmentObjectKey(user, 'Отчёт.pdf');
    expect(key).toMatch(SAFE_KEY);
    expect(key.split('/')[1]).toMatch(/-file\.pdf$/);
  });

  it('обход каталогов и разделители пути не попадают в ключ', () => {
    const key = createAttachmentObjectKey(user, '../../etc/passwd');
    expect(key.split('/')).toHaveLength(2);
    expect(key).not.toContain('..');
  });

  it('два файла с одним именем получают разные ключи', () => {
    expect(createAttachmentObjectKey(user, 'a.txt')).not.toBe(
      createAttachmentObjectKey(user, 'a.txt'),
    );
  });

  it('очень длинное имя укорачивается, расширение остаётся', () => {
    const key = createAttachmentObjectKey(user, `${'а'.repeat(400)}.pdf`);
    expect(key).toMatch(SAFE_KEY);
    expect(key.length).toBeLessThan(200);
    expect(key).toMatch(/\.pdf$/);
  });
});

describe('safeStorageName', () => {
  it('не бросает и не возвращает пустую строку', () => {
    for (const name of ['', '.', '..', '   ', '///', 'Отчёт']) {
      expect(safeStorageName(name)).toMatch(/^[A-Za-z0-9._-]+$/);
    }
  });
});

describe('SupabaseStorageAdapter.getDownloadUrl', () => {
  function fakeClient() {
    const calls: unknown[][] = [];
    const client = {
      storage: {
        from: () => ({
          createSignedUrl: async (...args: unknown[]) => {
            calls.push(args);
            return { data: { signedUrl: 'https://storage.test/sign/x?token=t' }, error: null };
          },
        }),
      },
    };
    return { client, calls };
  }

  it('передаёт исходное имя файла, чтобы скачанный файл назывался как у пользователя', async () => {
    const { client, calls } = fakeClient();
    const adapter = new SupabaseStorageAdapter(client as never);
    const url = await adapter.getDownloadUrl('u/k-file.pdf', 60, 'Договор "Q3".pdf');
    // Имя уходит в запрос ровно один раз: supabase-js через опцию кодирует его дважды.
    expect(calls[0]).toEqual(['u/k-file.pdf', 60]);
    expect(new URL(url).searchParams.get('download')).toBe('Договор "Q3".pdf');
    expect(new URL(url).searchParams.get('token')).toBe('t');
  });

  it('без имени ведёт себя как раньше', async () => {
    const { client, calls } = fakeClient();
    const adapter = new SupabaseStorageAdapter(client as never);
    await adapter.getDownloadUrl('u/k-file.pdf', 60);
    expect(calls[0]).toEqual(['u/k-file.pdf', 60]);
  });
});
