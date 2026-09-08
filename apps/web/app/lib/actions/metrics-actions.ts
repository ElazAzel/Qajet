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
  const token = createSignedLink(JURY_SCOPE, {}, JURY_LINK_TTL_SECONDS);
  return { ok: true, token };
}
