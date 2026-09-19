'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { actionFailure } from '../action-result';
import { requireCurrentUser } from '../current-user';
import { EDITABLE_SETTINGS } from '../settings-catalog';
import type { ActionResult } from './request-actions';

/**
 * Правка параметров экономики вживую — agents.md §9: «стоимость часа
 * закупщика и ставка комиссии — параметры в settings, чтобы на сцене можно
 * было при вопросе жюри поменять цифру и показать пересчёт вживую. Это
 * очень сильный момент».
 *
 * До этого `settings` читалась из четырёх мест приложения и не писалась ни
 * из одного: «поменять цифру» означало лезть в базу руками.
 *
 * Правит только админ — и это проверяет RLS (`settings_write_admin`), а
 * проверка роли здесь нужна для понятного сообщения вместо сырой ошибки
 * Postgres. Список допустимых ключей — белый, а не «любой ключ, что
 * прислали»: settings хранит и `qajet_requisites`, ломать который
 * произвольным числом из формы нельзя.
 */
export async function updateSetting(key: string, value: number): Promise<ActionResult> {
  const user = await requireCurrentUser();
  if (user.role !== 'admin') {
    return { ok: false, error: 'Менять параметры экономики может только админ' };
  }

  const definition = EDITABLE_SETTINGS.find((s) => s.key === key);
  if (!definition) return { ok: false, error: 'Этот параметр не редактируется' };
  if (!Number.isFinite(value) || value < definition.min || value > definition.max) {
    return {
      ok: false,
      error: `${definition.label}: допустимо от ${definition.min} до ${definition.max}`,
    };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('settings')
    .update({ value, updated_at: new Date().toISOString() })
    .eq('key', key);
  if (error) return actionFailure('settings.updateSetting', error);

  // Параметры влияют на подбор, сравнение и юнит-экономику — пересчитать
  // надо все экраны, которые их читают, а не только сам экран настроек.
  revalidatePath('/admin/settings');
  revalidatePath('/metrics');
  revalidatePath('/concierge');
  return { ok: true };
}
