import 'server-only';

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export const STORAGE_BUCKET = 'qajet-docs';
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const ALLOWED_ATTACHMENT_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

/** Разовое право браузера положить один объект прямо в Storage. */
export interface UploadGrant {
  path: string;
  token: string;
}

/** Что Storage реально хранит — не то, что заявил браузер. */
export interface StoredObject {
  size: number;
  contentType: string;
}

export interface StorageAdapter {
  createUploadGrant(objectKey: string): Promise<UploadGrant>;
  stat(objectKey: string): Promise<StoredObject | null>;
  getDownloadUrl(
    objectKey: string,
    expiresInSeconds?: number,
    downloadName?: string,
  ): Promise<string>;
  delete(objectKey: string): Promise<void>;
}

export class SupabaseStorageAdapter implements StorageAdapter {
  constructor(
    private readonly client: SupabaseClient,
    private readonly bucket = STORAGE_BUCKET,
  ) {}

  /**
   * Файл идёт из браузера прямо в Storage, мимо функции приложения: Vercel
   * отрезает тело запроса к функции на ~4,5 МБ, а вложение бывает до 10 МБ.
   * Лимит размера и список типов Storage проверяет сам (настройки бакета).
   */
  async createUploadGrant(objectKey: string): Promise<UploadGrant> {
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUploadUrl(objectKey);
    if (error || !data) throw new Error(error?.message ?? 'Не удалось выдать право на загрузку');
    return { path: data.path, token: data.token };
  }

  async stat(objectKey: string): Promise<StoredObject | null> {
    const { data, error } = await this.client.storage.from(this.bucket).info(objectKey);
    if (error || !data) return null;
    return { size: data.size ?? 0, contentType: data.contentType ?? '' };
  }

  /**
   * `downloadName` — исходное имя файла пользователя: ключ объекта только ASCII, и
   * без этого скачанный файл назывался бы `file.pdf`, а не «Договор.pdf».
   *
   * Параметр `download` дописываем сами, а не через опцию createSignedUrl:
   * supabase-js кодирует его дважды, и заголовок Content-Disposition получается
   * `%25D0%2594…`, то есть браузер показывает «%D0%94…» вместо имени. Проверено на
   * локальном Storage; подпись токена от этого параметра не зависит.
   */
  async getDownloadUrl(
    objectKey: string,
    expiresInSeconds = 60,
    downloadName?: string,
  ): Promise<string> {
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUrl(objectKey, expiresInSeconds);
    if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Не удалось выдать ссылку');
    if (!downloadName) return data.signedUrl;
    const url = new URL(data.signedUrl);
    url.searchParams.set('download', downloadName);
    return url.toString();
  }

  async delete(objectKey: string): Promise<void> {
    const { error } = await this.client.storage.from(this.bucket).remove([objectKey]);
    if (error) throw new Error(error.message);
  }
}

/**
 * Часть ключа объекта из имени файла. Только ASCII: Storage отвечает `Invalid key`
 * на кириллицу и многие символы, и раньше вложение с русским именем не
 * загружалось вовсе. Отображаемое имя хранится отдельно (`attachments.file_name`);
 * здесь важны безопасность и расширение, чтобы файл открывался нужной программой.
 * Имя целиком из не-ASCII символов превращается в `file` с прежним расширением.
 */
export function safeStorageName(fileName: string): string {
  const basename = fileName.split(/[\\/]/).at(-1) ?? 'file';
  const dot = basename.lastIndexOf('.');
  const rawExtension = dot > 0 ? basename.slice(dot + 1) : '';
  const extension = /^[A-Za-z0-9]{1,10}$/.test(rawExtension) ? rawExtension.toLowerCase() : '';
  const rawBase = extension ? basename.slice(0, dot) : basename;
  const base = rawBase
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 100);
  return `${base || 'file'}${extension ? `.${extension}` : ''}`;
}

export function createAttachmentObjectKey(userId: string, fileName: string): string {
  return `${userId}/${randomUUID()}-${safeStorageName(fileName)}`;
}
