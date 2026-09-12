import { cn } from '@qajet/ui/lib/cn';
import { Reveal } from '@qajet/ui/motion';
import { buttonClass } from '@qajet/ui/primitives';
import Link from 'next/link';
import { requireCurrentUser } from '../../lib/current-user';

/**
 * Настройки покупателя — профиль сотрудника и уведомления. Лимиты
 * согласования и приглашение сотрудников вынесены на отдельный экран
 * `/buyer/team`.
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
          </div>
        </section>

        <section className="mb-5 rounded-card border border-rule bg-surface p-6">
          <h3 className="mb-1 text-sm font-semibold">Личные данные</h3>
          <p className="mb-4 text-fine text-muted">
            Профиль заводит QAJET. Смена имени или почты — через поддержку: у покупательской сессии
            нет права переписывать учётную запись.
          </p>
          <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-fine font-semibold">Имя</span>
              <input
                type="text"
                defaultValue={first}
                disabled
                className={cn(inputClass, 'text-muted')}
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-fine font-semibold">Фамилия</span>
              <input
                type="text"
                defaultValue={last}
                disabled
                className={cn(inputClass, 'text-muted')}
              />
            </label>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-fine font-semibold">Email</span>
              <input
                type="email"
                defaultValue={user.email}
                disabled
                className={cn(inputClass, 'text-muted')}
              />
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
          <h3 className="mb-1 text-sm font-semibold">Команда и доступы</h3>
          <p className="mb-4 text-fine text-muted">
            Лимиты согласования, права сотрудников и отзыв доступа — на отдельном экране.
          </p>
          <Link href="/buyer/team" className={buttonClass('secondary', 'sm')}>
            Открыть команду
          </Link>
        </section>
      </Reveal>
    </div>
  );
}
