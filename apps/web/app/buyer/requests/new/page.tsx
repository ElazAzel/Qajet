import { cn } from '@qajet/ui/lib/cn';
import { Reveal, Stagger, Stamp } from '@qajet/ui/motion';
import { Button } from '@qajet/ui/primitives';
import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Мастер новой заявки — §10 «Покупатель»: свободное описание и файлы →
 * распознанная спецификация с явными пробелами → свои поставщики →
 * отправка. Экран визуальный (интейк-парсер и шаги 2–4 — отдельная фаза
 * движка, agents.md §14) — здесь первый шаг мастера, реальная форма без
 * отправки на сервер.
 */

const STEPS: { n: number; title: string; sub: string; active?: boolean }[] = [
  { n: 1, title: 'Заявка', sub: 'Опишите задачу и приложите файлы', active: true },
  { n: 2, title: 'Спецификация', sub: 'Проверьте распознанные позиции' },
  { n: 3, title: 'Поставщики', sub: 'Свои поставщики или подбор QAJET' },
  { n: 4, title: 'Проверка и отправка', sub: 'Отправка на предоплату' },
];

const NEXT_STEPS = [
  {
    title: 'Вы описываете задачу своими словами',
    sub: 'Текстом и файлами — как обычно ставите её сотруднику',
  },
  {
    title: 'QAJET разбирает её на спецификацию',
    sub: 'Позиции, количества, характеристики — пробелы помечаются явно',
  },
  {
    title: 'Мы рассылаем RFQ проверенным поставщикам',
    sub: 'Видно, кому и почему выбран каждый поставщик',
  },
  {
    title: 'Вы сравниваете варианты и утверждаете план',
    sub: 'С этого момента план становится заказом',
  },
];

const inputClass =
  'w-full rounded-control border border-transparent bg-page px-4 py-3 text-sm text-ink placeholder:text-muted focus-visible:border-purple';

const secondaryLinkClass =
  'inline-flex h-10 items-center justify-center gap-2 rounded-control border border-rule bg-surface px-4 text-sm font-medium text-ink transition-colors duration-[var(--duration-instant)] hover:bg-page';

export default function NewRequestPage() {
  return (
    <div>
      <p className="mb-4 text-fine text-muted">
        <Link href="/buyer" className="hover:text-ink">
          Заказы
        </Link>
        <span className="mx-1.5">›</span>
        <span className="font-medium text-ink">Новая заявка</span>
      </p>

      <Reveal className="mb-7 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold">Новая заявка</h1>
          <p className="mt-2 text-sm text-muted">
            Опишите, что вам нужно, — QAJET разберёт заявку и найдёт подходящих поставщиков.
          </p>
        </div>
        <Button variant="secondary">Сохранить черновик</Button>
      </Reveal>

      <Reveal delay={0.06} className="mb-8 flex flex-wrap items-center gap-x-8 gap-y-4">
        {STEPS.map((step, i) => (
          <div key={step.n} className="flex items-center gap-3">
            <div
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                step.active ? 'bg-purple text-white' : 'bg-page text-muted',
              )}
            >
              {step.n}
            </div>
            <div>
              <p className={cn('text-fine font-semibold', step.active ? 'text-ink' : 'text-muted')}>
                {step.title}
              </p>
              <p className="text-micro text-muted">{step.sub}</p>
            </div>
            {i < STEPS.length - 1 && (
              <div className="hidden h-px w-10 bg-rule sm:block" aria-hidden="true" />
            )}
          </div>
        ))}
      </Reveal>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_340px]">
        <Reveal delay={0.12} className="rounded-card border border-rule bg-surface p-7">
          <h3 className="text-lg font-bold">Расскажите о задаче</h3>
          <p className="mt-1.5 mb-5 text-fine text-muted">
            Чем подробнее описание, тем точнее будет распознанная спецификация.
          </p>

          <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="request-title" label="Название заявки" required>
              <input
                id="request-title"
                type="text"
                placeholder="Например, корпоративные подарки на Наурыз"
                className={inputClass}
              />
            </Field>
            <Field id="request-city" label="Город доставки" required>
              <select id="request-city" className={inputClass} defaultValue="Алматы">
                <option>Алматы</option>
                <option>Астана</option>
                <option>Шымкент</option>
              </select>
            </Field>
          </div>

          <div className="mb-4">
            <Field id="request-description" label="Описание заявки" required>
              <textarea
                id="request-description"
                rows={4}
                placeholder="Что заказываем, для кого, к какому событию. Укажите тираж, если он уже известен…"
                className={cn(inputClass, 'resize-none')}
              />
            </Field>
          </div>

          <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="request-budget" label="Бюджет, ориентировочно">
              <input
                id="request-budget"
                type="text"
                placeholder="До 1 200 000 ₸"
                className={inputClass}
              />
            </Field>
            <Field id="request-date" label="Нужна дата доставки">
              <input id="request-date" type="date" className={inputClass} />
            </Field>
          </div>

          <div className="mb-6">
            <p className="mb-1 text-fine font-semibold">Файлы и материалы</p>
            <p className="mb-2.5 text-micro text-muted">
              Техническое задание, примеры, макеты — что угодно, что поможет точнее собрать
              спецификацию.
            </p>
            <div className="rounded-control border border-rule border-dashed px-6 py-8 text-center text-muted">
              <p className="text-sm font-semibold text-ink">
                Перетащите файлы сюда или нажмите для загрузки
              </p>
              <p className="mt-1 text-micro">PDF, DOC, XLS, PNG, JPG до 10 МБ</p>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Link href="/buyer" className={secondaryLinkClass}>
              Отмена
            </Link>
            <Button variant="primary">Продолжить</Button>
          </div>
        </Reveal>

        <Stagger className="flex flex-col gap-4" as="div">
          {[
            <div key="summary" className="rounded-card border border-rule bg-surface p-5">
              <h3 className="mb-4 text-sm font-semibold">Кратко о заявке</h3>
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-purple-10 text-base">
                  🎁
                </div>
                <p className="flex-1 text-sm font-semibold">Новая заявка</p>
                <Stamp tone="neutral" className="shrink-0">
                  Черновик
                </Stamp>
              </div>
              <dl className="flex flex-col gap-2.5 text-fine">
                <div className="flex justify-between border-t border-rule pt-2.5">
                  <dt className="text-muted">Город доставки</dt>
                  <dd className="font-semibold">Алматы</dd>
                </div>
                <div className="flex justify-between border-t border-rule pt-2.5">
                  <dt className="text-muted">Планируемая дата</dt>
                  <dd className="font-semibold text-muted">Не указана</dd>
                </div>
                <div className="flex justify-between border-t border-rule pt-2.5">
                  <dt className="text-muted">Бюджет</dt>
                  <dd className="font-semibold text-muted">Не указан</dd>
                </div>
              </dl>
            </div>,
            <div key="hint" className="flex gap-2.5 rounded-card bg-purple-10 p-4 text-fine">
              <span aria-hidden="true">ⓘ</span>
              <span>Позиции, количества и требуемые техпроцессы вы укажете на следующем шаге.</span>
            </div>,
            <div key="next" className="rounded-card border border-rule bg-surface p-5">
              <h3 className="mb-4 text-sm font-semibold">Что дальше?</h3>
              <div className="flex flex-col gap-4">
                {NEXT_STEPS.map((step, i) => (
                  <div key={step.title} className="flex gap-3">
                    <div
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-micro font-semibold',
                        i === 0 ? 'bg-purple text-white' : 'bg-page text-muted',
                      )}
                    >
                      {i + 1}
                    </div>
                    <div>
                      <p className="text-fine font-semibold">{step.title}</p>
                      <p className="text-micro text-muted">{step.sub}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>,
          ]}
        </Stagger>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  required,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="block">
      <label htmlFor={id} className="mb-2 block text-fine font-semibold">
        {label}
        {required && <span className="text-muted"> *</span>}
      </label>
      {children}
    </div>
  );
}
