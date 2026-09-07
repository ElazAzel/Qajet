import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Бэкенд-абстракция для персональных данных — agents.md §11.1.
 *
 * «Для MVP: весь доступ к персональным данным идёт через пакет packages/pd
 * с конфигурируемым бэкендом, и в README прописан порядок переезда на
 * казахстанский ДЦ. Не размазывать чтение персональных данных по всему
 * коду.»
 *
 * Сегодня единственная реализация читает те же таблицы Supabase (MVP-БД
 * в us-east-1) через RLS-сессию вызывающего пользователя — физически ПД
 * лежит там же, где и остальные данные. Переезд на казахстанский ДЦ —
 * это НОВАЯ реализация PdBackend (например, отдельный Postgres в РК,
 * куда таблицы users/requests частично реплицированы или перенесены),
 * подключаемая в `createPdClient()` одной строкой конфигурации. Ни один
 * вызывающий код (apps/web) не меняется, потому что он знает только
 * интерфейс `PdBackend`, а не то, где физически лежат данные.
 */

export interface UserContact {
  id: string;
  fullName: string;
  email: string;
}

export interface DeliveryAddress {
  requestId: string;
  address: string;
}

export interface PdBackend {
  /** users.full_name/email — agents.md §11.1 персональные данные сотрудника. */
  getUserContact(userId: string): Promise<UserContact | null>;
  /** requests.delivery_address — адрес физического лица/офиса получателя. */
  getDeliveryAddress(requestId: string): Promise<DeliveryAddress | null>;
}

/**
 * MVP-бэкенд: та же Supabase-сессия, что и остальные запросы приложения.
 * RLS уже ограничивает видимость строк ролью текущего пользователя —
 * этот бэкенд её не обходит и не поднимает привилегии.
 */
export function createSupabasePdBackend(supabase: SupabaseClient): PdBackend {
  return {
    async getUserContact(userId) {
      const { data } = await supabase
        .from('users')
        .select('id, full_name, email')
        .eq('id', userId)
        .maybeSingle();
      if (!data) return null;
      return { id: data.id, fullName: data.full_name, email: data.email };
    },

    async getDeliveryAddress(requestId) {
      const { data } = await supabase
        .from('requests')
        .select('id, delivery_address')
        .eq('id', requestId)
        .maybeSingle();
      if (!data?.delivery_address) return null;
      return { requestId: data.id, address: data.delivery_address };
    },
  };
}
