-- Новые функции больше не получают EXECUTE автоматически — продолжение 0042.
--
-- В PostgreSQL функция при создании получает EXECUTE для PUBLIC, а anon
-- входит в PUBLIC. Схемный ALTER DEFAULT PRIVILEGES ... IN SCHEMA этот
-- встроенный грант не снимает (документация: PUBLIC отзывается только
-- глобальной формой), поэтому 0042 закрыл существующие функции, но новая
-- функция снова оказывалась вызываемой анонимно. Проверено пробой: функция,
-- созданная после 0042, была доступна anon.
--
-- Область действия — только функции, создаваемые ролью postgres, то есть
-- миграциями этого проекта. Функции расширений и служебных схем Supabase
-- создают другие роли и не затрагиваются. Уже выданные права не меняются.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;
