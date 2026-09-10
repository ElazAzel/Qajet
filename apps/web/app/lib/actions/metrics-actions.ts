'use server';

import { JURY_LINK_TTL_SECONDS, JURY_SCOPE } from '../../metrics/_jury-access';
import { requireCurrentUser } from '../current-user';
import { createSignedLink } from '../signed-link';

export interface GenerateJuryLinkResult {
  ok: boolean;
  token?: string;
  error?: string;
}

/** Только админ может выпустить ссылку для жюри — та же роль, что уже видит /metrics под своей сессией. */
export async function generateJuryLink(): Promise<GenerateJuryLinkResult> {
  const user = await requireCurrentUser();
  if (user.role !== 'admin') {
    return { ok: false, error: 'Только админ может создать ссылку для жюри' };
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return { ok: false, error: 'Доступ для жюри не настроен в этом окружении.' };
  }
  try {
    const token = createSignedLink(JURY_SCOPE, {}, JURY_LINK_TTL_SECONDS);
    return { ok: true, token };
  } catch {
    return { ok: false, error: 'Секрет подписанных ссылок не настроен.' };
  }
}
