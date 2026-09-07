import { cn } from '@qajet/ui/lib/cn';
import { Reveal } from '@qajet/ui/motion';
import { Button } from '@qajet/ui/primitives';

/**
 * Настройки покупателя — профиль сотрудника и уведомления. Лимиты
 * согласования и приглашение сотрудников живут на /buyer/team (agents.md
 * §10 «Команда и доступы»), здесь — личный профиль и оповещения.
 */

const TABS = [
  { label: 'Профиль', active: true },
  { label: 'Организация' },
  { label: 'Уведомления' },
  { label: 'Безопасность' },
];

const TOGGLES = [
  {
    title: 'Обновления по заказам',
    sub: 'Смена стадии, новые предложения, приближающийся срок',
    on: true,
  },
  { title: 'Сообщения', sub: 'Новые сообщения от поставщиков и консьержа', on: true },
  { title: 'Новости продукта', sub: 'Обновления и советы от QAJET', on: false },
];

const inputClass = 'w-full rounded-control bg-page px-4 py-3 text-sm text-ink';

export default function BuyerSettingsPage() {
  return (
    <div className="grid grid-cols-1 gap-8 md:grid-cols-[200px_1fr]">
      <nav className="flex gap-1 overflow-x-auto md:flex-col">
        {TABS.map((tab) => (
          <span
            key={tab.label}
            className={cn(
              'shrink-0 rounded-control px-3.5 py-2.5 text-fine font-semibold',
              tab.active ? 'bg-purple-10 text-purple' : 'text-muted',
            )}
          >
            {tab.label}
          </span>
        ))}
      </nav>

      <Reveal className="max-w-xl">
        <h1 className="mb-6 text-2xl font-extrabold">Профиль</h1>

        <section className="mb-5 rounded-card border border-rule bg-surface p-6">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 shrink-0 rounded-full bg-page" aria-hidden="true" />
            <div className="flex-1">
              <p className="text-sm font-semibold">Айгерим Сатпаева</p>
              <p className="text-fine text-muted">ТОО «Nomad Tech»</p>
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
              <input type="text" defaultValue="Айгерим" className={inputClass} />
            </label>
            <label className="block">
              <span className="mb-2 block text-fine font-semibold">Фамилия</span>
              <input type="text" defaultValue="Сатпаева" className={inputClass} />
            </label>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-fine font-semibold">Email</span>
              <input type="email" defaultValue="aigerim@nomadtech.kz" className={inputClass} />
            </label>
            <label className="block">
              <span className="mb-2 block text-fine font-semibold">Телефон</span>
              <input type="tel" defaultValue="+7 701 234 56 78" className={inputClass} />
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
