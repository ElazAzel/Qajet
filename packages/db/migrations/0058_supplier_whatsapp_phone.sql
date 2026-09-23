-- WhatsApp-номер поставщика для напоминаний о RFQ.
--
-- Поставщики на старте получают мало заказов и не следят за сайтом; консьерж
-- напоминает им в WhatsApp. Номер — персональные данные (ADR-0011): колонка живёт
-- в supplier_profiles, чьи политики уже ограничивают чтение своей компанией и
-- staff, а запись — своей компанией. Отдельных политик не нужно.
-- Формат проверяет база, а не только форма: +7 и десять цифр.
-- Аддитивно: новая nullable-колонка и CHECK, пропускающий NULL.
-- Тест: packages/db/src/__tests__/supplier-whatsapp-phone.test.ts.

ALTER TABLE "supplier_profiles" ADD COLUMN "whatsapp_phone" text;--> statement-breakpoint
ALTER TABLE "supplier_profiles" ADD CONSTRAINT "supplier_profiles_whatsapp_phone_format" CHECK ("supplier_profiles"."whatsapp_phone" ~ '^\+7[0-9]{10}$');