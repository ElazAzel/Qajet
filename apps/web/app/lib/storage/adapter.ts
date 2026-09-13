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

export interface StorageAdapter {
  put(objectKey: string, file: Blob, contentType: string): Promise<void>;
  getDownloadUrl(objectKey: string, expiresInSeconds?: number): Promise<string>;
  delete(objectKey: string): Promise<void>;
}

export class SupabaseStorageAdapter implements StorageAdapter {
  constructor(
    private readonly client: SupabaseClient,
    private readonly bucket = STORAGE_BUCKET,
  ) {}

  async put(objectKey: string, file: Blob, contentType: string): Promise<void> {
    const { error } = await this.client.storage.from(this.bucket).upload(objectKey, file, {
      contentType,
      cacheControl: 'private, max-age=0',
      upsert: false,
    });
    if (error) throw new Error(error.message);
  }

  async getDownloadUrl(objectKey: string, expiresInSeconds = 60): Promise<string> {
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUrl(objectKey, expiresInSeconds);
    if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Не удалось выдать ссылку');
    return data.signedUrl;
  }

  async delete(objectKey: string): Promise<void> {
    const { error } = await this.client.storage.from(this.bucket).remove([objectKey]);
    if (error) throw new Error(error.message);
  }
}

export function safeStorageName(fileName: string): string {
  const basename = fileName.split(/[\\/]/).at(-1) ?? 'file';
  const normalized = basename.normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu, '-');
  return normalized.slice(0, 120) || 'file';
}

export function createAttachmentObjectKey(userId: string, fileName: string): string {
  return `${userId}/${randomUUID()}-${safeStorageName(fileName)}`;
}
