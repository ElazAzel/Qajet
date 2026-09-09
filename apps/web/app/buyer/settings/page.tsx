import { cn } from '@qajet/ui/lib/cn';
import { Reveal } from '@qajet/ui/motion';
import { Button } from '@qajet/ui/primitives';
import { requireCurrentUser } from '../../lib/current-user';

/**
 * Настройки покупателя — профиль сотрудника и уведомления. Лимиты
 * согласования и приглашение сотрудников (agents.md §10 «Команда и
 * доступы») не реализованы — экран /buyer/team не существует, пункт нав
 * убран (apps/web/app/buyer/layout.tsx), здесь пока только личный профиль
 * и оповещения.
 *
 * Раньше форма профиля была на 100% захардкожена вымышленным человеком
 * («Айгерим Сатпаева, ТОО Nomad Tech») — при этом шапка оболочки рядом
 * показывала настоящего залогиненного пользователя. Найдено при UI-
 * аудите. Имя/email/компания теперь из requireCurrentUser() (тот же
 * источник, что у шапки). «Сохранить изменения» пока не пишет в БД —
 * на users нет ни одной policy на UPDATE вообще (только own/staff SELECT,
 * см. packages/db/src/schema/identity.ts), а смена email — отдельный
 * поток через Supabase Auth API, не прямой UPDATE строки. Заводить то и
 * другое — отдельная задача, не подмена вымышленных данных на реальные.
 * Поле «Телефон» убрано, а не оставлено пустым — в схеме users нет
 * такой колонки вообще, пустой ввод без единого шанса когда-либо
 * сохраниться был бы так же вводящим в заблуждение, как и вымысел.
 *
 * Прежняя навигация «Профиль/Организация/Уведомления/Безопасность» была
 * рядом строк без onClick — переключала только цвет активного пункта,
 * содержимое всегда было одно и то же (в том числе секция уведомлений
 * рендерилась независимо от того, какой пункт «активен»). «Организация»
 * и «Безопасность» не имеют вообще никакого экрана за собой. Убрана —
 * обещание переключения контента, которого нет, хуже отсутствия
 * навигации. Что реально есть на странице — обычные разделы ниже.
 */

const TOGGLES = [
  {
    title: 'Обновления по заказам',
    sub: 'Смена стадии, новые предложения, приближающийся срок',
    on: true,
  },
  { title: 'Сообщения', sub: 'Новые сообщения от QAJET по вашим заказам', on: true },
  { title: 'Новости продукта', sub: 'Обновления и советы от QAJET', on: false },
];

const ROLE_LABEL: Record<string, string> = {
  owner: 'Владелец компании',
  manager: 'Менеджер',
};

const inputClass = 'w-full rounded-control bg-page px-4 py-3 text-sm text-ink';

function splitName(fullName: string): { first: string; last: string } {
  const [first = '', ...rest] = fullName.trim().split(/\s+/);
  return { first, last: rest.join(' ') };
}

export default async function BuyerSettingsPage() {
  const user = await requireCurrentUser();
  const { first, last } = splitName(user.fullName);

  return (
    <div>
      <Reveal className="max-w-xl">
        <h1 className="mb-6 text-2xl font-extrabold">Настройки</h1>

        <section className="mb-5 rounded-card border border-rule bg-surface p-6">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 shrink-0 rounded-full bg-page" aria-hidden="true" />
            <div className="flex-1">
              <p className="text-sm font-semibold">{user.fullName}</p>
              <p className="text-fine text-muted">{user.companyName ?? '—'}</p>
            </div>
            <Button variant="secondary" size="sm">
              Изменить фото
            </Button>
          </div>
        </section>

        <section className="mb-5 rounded-card border border-rule bg-surface p-6">
          <h3 className="mb-4 text-sm font-semibold">Личные данные</h3>
          <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-fine font-semibold">Имя</span>
              <input type="text" defaultValue={first} className={inputClass} />
            </label>
            <label className="block">
              <span className="mb-2 block text-fine font-semibold">Фамилия</span>
              <input type="text" defaultValue={last} className={inputClass} />
            </label>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-fine font-semibold">Email</span>
              <input type="email" defaultValue={user.email} className={inputClass} />
            </label>
            <label className="block">
              <span className="mb-2 block text-fine font-semibold">Роль</span>
              <input
                type="text"
                defaultValue={ROLE_LABEL[user.role] ?? user.role}
                disabled
                className={cn(inputClass, 'text-muted')}
              />
            </label>
          </div>
        </section>

        <section className="mb-6 rounded-card border border-rule bg-surface p-6">
          <h3 className="mb-1 text-sm font-semibold">Уведомления</h3>
          <p className="mb-4 text-fine text-muted">Выберите, о чём вам сообщать.</p>
          <div className="flex flex-col gap-4">
            {TOGGLES.map((t) => (
              <div key={t.title} className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold">{t.title}</p>
                  <p className="text-fine text-muted">{t.sub}</p>
                </div>
                <button
                  type="button"
                  className={cn(
                    'relative h-6 w-10 shrink-0 rounded-full',
                    t.on ? 'bg-purple' : 'bg-page',
                  )}
                  role="switch"
                  aria-checked={t.on}
                  aria-label={t.title}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 h-5 w-5 rounded-full bg-surface transition-[left] duration-[var(--duration-quick)]',
                      t.on ? 'left-[19px]' : 'left-0.5',
                    )}
                  />
                </button>
              </div>
            ))}
          </div>
        </section>

        <Button variant="primary">Сохранить изменения</Button>
      </Reveal>
    </div>
  );
}
