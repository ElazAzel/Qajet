'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { actionFailure } from '../action-result';
import { orderActorFor, requireCurrentUser } from '../current-user';
import type { ActionResult } from './request-actions';

/**
 * Управление учётными записями администратором QAJET.
 *
 * Блокировка и правка идут через RPC `admin_set_user_active` и
 * `admin_update_user` (миграция 0056), а НЕ сервисным клиентом: проверка живёт
 * внутри функции в базе и действует для любого вызывающего. Проверка
 * `requireAdmin()` здесь — второй рубеж и способ дать человеку внятный отказ,
 * а не единственная защита.
 *
 * Создание — исключение: завести пользователя в Supabase Auth может только
 * серверный ключ, база этого сделать не умеет. Поэтому создание идёт сервисным
 * клиентом, как и подключение компании, и авторизуется здесь.
 */

const ROLES = ['owner', 'manager', 'concierge', 'admin'] as const;

const createUserSchema = z
  .object({
    email: z.string().trim().email().max(320),
    fullName: z.string().trim().min(2).max(120),
    role: z.enum(ROLES),
    /** Пусто для персонала QAJET: consierge и admin живут вне компаний. */
    companyId: z.string().uuid().nullable(),
  })
  .strict()
  .refine((value) => (value.role === 'concierge' || value.role === 'admin') === !value.companyId, {
    message: 'Персонал QAJET заводится без компании, сотрудник компании — с компанией',
    path: ['companyId'],
  });

export type CreateUserInput = z.infer<typeof createUserSchema>;

async function requireAdmin() {
  const user = await requireCurrentUser();
  return orderActorFor(user) === 'admin' ? user : null;
}

const DENIED = 'Только админ QAJET может управлять учётными записями';

/**
 * Заводит учётную запись и отправляет приглашение. Пароль не задаётся и не
 * генерируется здесь: человек задаёт его сам по ссылке из письма.
 */
export async function createUser(rawInput: CreateUserInput): Promise<ActionResult> {
  if (!(await requireAdmin())) return { ok: false, error: DENIED, code: 'forbidden' };

  const parsed = createUserSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Проверьте поля',
      code: 'invalid',
    };
  }
  const input = parsed.data;

  let service: ReturnType<typeof createSupabaseAdminClient>;
  try {
    service = createSupabaseAdminClient();
  } catch (error) {
    return actionFailure('user.createUser', error, 'Admin API недоступен');
  }

  const { data: invited, error: inviteError } = await service.auth.admin.inviteUserByEmail(
    input.email,
    {
      data: {
        full_name: input.fullName,
        company_id: input.companyId,
        role: input.role,
      },
    },
  );
  if (inviteError || !invited.user) {
    return actionFailure('user.createUser', inviteError, 'Не удалось отправить приглашение');
  }

  const { error: profileError } = await service.from('users').insert({
    id: invited.user.id,
    company_id: input.companyId,
    email: input.email,
    full_name: input.fullName,
    role: input.role,
    is_active: true,
  });
  if (profileError) {
    // Учётная запись Auth без профиля — мусор, который потом блокирует повторное
    // приглашение на тот же адрес. Убираем её сразу.
    await service.auth.admin.deleteUser(invited.user.id);
    return actionFailure('user.createUser', profileError, 'Не удалось создать учётную запись');
  }

  revalidatePath('/admin/users');
  return { ok: true };
}

/** Блокирует или разблокирует учётную запись. Строка не удаляется: история действий сохраняется. */
export async function setUserActive(userId: string, active: boolean): Promise<ActionResult> {
  if (!(await requireAdmin())) return { ok: false, error: DENIED, code: 'forbidden' };
  if (!z.string().uuid().safeParse(userId).success) {
    return { ok: false, error: 'Учётная запись не найдена', code: 'not_found' };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('admin_set_user_active', {
    p_user_id: userId,
    p_active: active,
  });
  if (error) return actionFailure('user.setUserActive', error, 'Не удалось изменить доступ');

  revalidatePath('/admin/users');
  return { ok: true };
}

const updateUserSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120).optional(),
    role: z.enum(ROLES).optional(),
  })
  .strict();

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/** Меняет имя и роль. Незаданное поле остаётся прежним, а не очищается. */
export async function updateUser(userId: string, rawInput: UpdateUserInput): Promise<ActionResult> {
  if (!(await requireAdmin())) return { ok: false, error: DENIED, code: 'forbidden' };
  if (!z.string().uuid().safeParse(userId).success) {
    return { ok: false, error: 'Учётная запись не найдена', code: 'not_found' };
  }
  const parsed = updateUserSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: 'Проверьте имя и роль', code: 'invalid' };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('admin_update_user', {
    p_user_id: userId,
    p_full_name: parsed.data.fullName ?? null,
    p_role: parsed.data.role ?? null,
  });
  if (error) return actionFailure('user.updateUser', error, 'Не удалось сохранить изменения');

  revalidatePath('/admin/users');
  return { ok: true };
}
