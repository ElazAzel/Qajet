-- Изоляция вложений заказа — qajet-master-spec.md §3.4, ADR-0009.
--
-- До этой миграции поставщику было видно всё с тем же order_id: счета и
-- акты доставки другого поставщика и платёжка покупателя (из неё видно,
-- сколько покупатель заплатил QAJET). Покупателю были видны файлы
-- поставщиков, хотя личность исполнителя от него скрыта. Воспроизведено
-- тестом packages/db/src/__tests__/attachment-isolation.test.ts.
--
-- is_staff_user — узкий хелпер для политики покупателя: строки сотрудников
-- QAJET в users покупателю не видны по RLS, поэтому проверить «файл
-- загрузил сотрудник QAJET» без SECURITY DEFINER нельзя. Функция отвечает
-- только да/нет по одному id. is_active не проверяется намеренно: после
-- отзыва доступа история остаётся видимой (§3.2).
CREATE OR REPLACE FUNCTION public.is_staff_user(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_user_id AND role IN ('concierge', 'admin')
  );
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.is_staff_user(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.is_staff_user(uuid) TO authenticated, service_role;--> statement-breakpoint
ALTER POLICY "attachments_select_buyer" ON "attachments" TO authenticated USING ("attachments"."kind" <> 'supplier_invoice' and exists (
        select 1 from "companies" c where c.id = (select public.current_company_id()) and c.type = 'buyer'
      ) and (
        exists (select 1 from "users" u where u.id = "attachments"."uploaded_by" and u.company_id = (select public.current_company_id())) or
        public.is_staff_user("attachments"."uploaded_by")
      ) and (
        "attachments"."request_id" in (select id from "requests") or
        "attachments"."order_id" in (select id from "orders") or
        "attachments"."thread_id" in (select id from "threads" where kind = 'buyer') or
        "attachments"."message_id" in (select m.id from "messages" m join "threads" th on th.id = m.thread_id where th.kind = 'buyer')
      ));--> statement-breakpoint
ALTER POLICY "attachments_select_supplier" ON "attachments" TO authenticated USING ((
        "attachments"."thread_id" in (select id from "threads" where kind = 'supplier' and supplier_company_id = (select public.current_company_id())) or
        "attachments"."message_id" in (select m.id from "messages" m join "threads" th on th.id = m.thread_id where th.kind = 'supplier' and th.supplier_company_id = (select public.current_company_id())) or
        ("attachments"."order_id" is not null and public.supplier_can_access_order("attachments"."order_id") and exists (
          select 1 from "users" u where u.id = "attachments"."uploaded_by" and u.company_id = (select public.current_company_id())
        ))
      ));