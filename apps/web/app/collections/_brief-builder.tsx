'use client';

import { ArrowRight, Check, Gift, PackageOpen, Shirt } from 'lucide-react';
import { useState } from 'react';
import { CONTACTS } from '../lib/contacts';
import { almatyToday } from '../lib/dates';
import {
  buildProgramBriefText,
  getProgram,
  getProgramCatalogItem,
  getProgramItems,
  PROGRAM_BRIEF_STORAGE_KEY,
  PROGRAM_CITIES,
  PROGRAMS,
  type ProgramCity,
  type ProgramId,
  parseProgramBrief,
  programBriefQuery,
} from '../lib/program-brief';

const icons = { welcome: PackageOpen, event: Shirt, 'team-gifts': Gift };
const inputClass =
  'mt-2 w-full rounded-control border border-rule bg-surface px-4 py-3 text-base text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple';

export function BriefBuilder({ initialProgram }: { initialProgram: ProgramId }) {
  const [programId, setProgramId] = useState(initialProgram);
  const program = getProgram(programId);
  const [qty, setQty] = useState(String(program.defaultQty));
  const [city, setCity] = useState<ProgramCity>('almaty');
  const [budget, setBudget] = useState('');
  const [date, setDate] = useState('');
  const [status, setStatus] = useState('');
  const today = almatyToday();
  const candidate = new URLSearchParams({ program: programId, qty, city });
  if (budget !== '') candidate.set('budget', budget);
  if (date !== '') candidate.set('date', date);
  const brief = parseProgramBrief(candidate.toString(), today);
  const message = brief ? buildProgramBriefText(brief) : '';
  const whatsapp = new URL(CONTACTS.whatsapp);
  whatsapp.searchParams.set('text', message);
  const qtyValid =
    /^\d+$/.test(qty) && Number(qty) >= program.qtyMin && Number(qty) <= program.qtyMax;

  function chooseProgram(id: ProgramId) {
    setProgramId(id);
    setQty(String(getProgram(id).defaultQty));
    setStatus('');
  }
  async function copyBrief() {
    try {
      await navigator.clipboard.writeText(message);
      setStatus('Бриф скопирован. Можно отправить его коллегам на согласование.');
    } catch {
      setStatus(
        'Не удалось скопировать автоматически. Выделите текст брифа ниже и скопируйте его.',
      );
    }
  }
  function continueInAccount() {
    if (!brief) return;
    try {
      sessionStorage.setItem(PROGRAM_BRIEF_STORAGE_KEY, programBriefQuery(brief));
      window.location.assign('/login?prepared=program');
    } catch {
      setStatus('Браузер не сохранил бриф. Скопируйте его текст ниже, затем откройте кабинет.');
    }
  }

  return (
    <div className="mt-10 grid items-start gap-8 lg:grid-cols-[1fr_360px]">
      <div className="min-w-0">
        <fieldset>
          <legend className="text-xl font-bold">1. Для какого повода?</legend>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {PROGRAMS.map((entry) => {
              const Icon = icons[entry.id];
              return (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={entry.id === programId}
                  onClick={() => chooseProgram(entry.id)}
                  className={`flex min-h-[100px] flex-col items-start rounded-card border p-5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-purple sm:min-h-44 ${entry.id === programId ? 'border-purple bg-purple-10' : 'border-rule bg-surface hover:border-purple/50'}`}
                >
                  <span className="flex w-full items-center justify-between text-purple">
                    <span className="flex items-center gap-3 sm:flex-col sm:items-start">
                      <Icon className="shrink-0" size={27} aria-hidden="true" />
                      <span className="text-base font-bold text-ink">{entry.occasion}</span>
                    </span>
                    {entry.id === programId && <Check size={18} aria-hidden="true" />}
                  </span>
                  <span className="mt-2 text-fine text-muted">
                    {entry.qtyMin}–{entry.qtyMax} получателей
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
        <section className="mt-10" aria-labelledby="brief-constraints">
          <h2 id="brief-constraints" className="text-xl font-bold">
            2. Масштаб, бюджет и дата
          </h2>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <label className="text-fine font-semibold">
              Количество получателей
              <input
                type="number"
                inputMode="numeric"
                min={program.qtyMin}
                max={program.qtyMax}
                step={1}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                aria-invalid={!qtyValid}
                aria-describedby="brief-qty-help"
                className={inputClass}
              />
              <span
                id="brief-qty-help"
                className={`mt-2 block text-fine font-normal ${qtyValid ? 'text-muted' : 'text-danger'}`}
              >
                Для этого состава: от {program.qtyMin} до {program.qtyMax}. Другой тираж обсудим
                отдельно.
              </span>
            </label>
            <label className="text-fine font-semibold">
              Город получения
              <select
                value={city}
                onChange={(e) => setCity(e.target.value as ProgramCity)}
                className={inputClass}
              >
                {Object.entries(PROGRAM_CITIES).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
              <span className="mt-2 block text-fine font-normal text-muted">
                Возможность и стоимость доставки подтвердим.
              </span>
            </label>
            <label className="text-fine font-semibold">
              Общий бюджет, ₸
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={10000000000}
                step={1}
                placeholder="Например, 500 000"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                className={inputClass}
              />
              <span className="mt-2 block text-fine font-normal text-muted">
                Ваш лимит на всю закупку с доставкой. Можно не указывать.
              </span>
            </label>
            <label className="text-fine font-semibold">
              Желаемая дата получения
              <input
                type="date"
                min={today}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={inputClass}
              />
              <span className="mt-2 block text-fine font-normal text-muted">
                Проверим возможность исполнения до согласования.
              </span>
            </label>
          </div>
          {!brief && (
            <p role="alert" className="mt-4 text-fine text-danger">
              Проверьте количество, бюджет и дату. Нужны целые положительные значения и дата не
              раньше сегодняшней.
            </p>
          )}
        </section>
        <section className="mt-10 border-rule border-t pt-8" aria-labelledby="brief-composition">
          <h2 id="brief-composition" className="text-xl font-bold">
            3. Предварительный состав
          </h2>
          <p className="mt-2 text-sm text-muted">
            {program.description} Можно изменить состав вместе с консьержем или в заявке.
          </p>
          <ul className="mt-5 divide-y divide-rule rounded-card border border-rule bg-surface px-5">
            {brief &&
              getProgramItems(brief).map((line) => (
                <li
                  key={line.itemKey}
                  className="flex items-start justify-between gap-4 py-4 text-sm"
                >
                  <span>{getProgramCatalogItem(line.itemKey).name}</span>
                  <span className="shrink-0 font-semibold">
                    {line.qty} {getProgramCatalogItem(line.itemKey).unit}
                  </span>
                </li>
              ))}
            {!brief && (
              <li className="py-4 text-fine text-muted">
                Состав появится после исправления полей выше.
              </li>
            )}
          </ul>
          <p className="mt-4 text-fine text-muted">
            Это основа брифа, а не товар в наличии и не коммерческое предложение. Наполнение,
            дизайн, цену и срок согласуем перед производством.
          </p>
        </section>
        <details className="mt-8 rounded-card border border-rule bg-surface p-5">
          <summary className="cursor-pointer text-sm font-semibold">
            Текст брифа для согласования
          </summary>
          <label className="mt-4 block text-fine text-muted">
            Готовый бриф
            <textarea
              readOnly
              rows={10}
              value={message}
              className={`${inputClass} resize-y text-fine leading-relaxed`}
            />
          </label>
        </details>
      </div>
      <aside
        className="rounded-hero bg-ink p-6 text-white lg:sticky lg:top-6"
        aria-label="Итог брифа"
      >
        <p className="text-fine font-semibold text-lime">Ваша закупочная задача</p>
        <h2 className="mt-3 text-2xl font-bold">{program.title}</h2>
        <dl className="mt-6 space-y-4 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-white/70">Получателей</dt>
            <dd className="font-semibold">{qtyValid ? qty : 'Проверьте тираж'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-white/70">Город</dt>
            <dd>{PROGRAM_CITIES[city]}</dd>
          </div>
          <div className="border-t border-white/15 pt-4">
            <dt className="text-white/70">Ваш бюджет на закупку</dt>
            <dd className="mt-2 text-3xl font-extrabold text-lime">
              {brief?.budgetKzt ? `${brief.budgetKzt.toLocaleString('ru-RU')} ₸` : 'Обсудим вместе'}
            </dd>
          </div>
          {brief?.budgetKzt && (
            <div>
              <dt className="text-white/70">Лимит на получателя</dt>
              <dd className="mt-1 text-lg font-bold">
                {(brief.budgetKzt / brief.qty).toLocaleString('ru-RU', {
                  maximumFractionDigits: 0,
                })}{' '}
                ₸
              </dd>
            </div>
          )}
        </dl>
        <p className="mt-5 text-fine text-white/70">
          Это ваш бюджет, не цена заказа. Консьерж согласует оценку и условия предоплаты. Итоговую
          цену и срок зафиксируем в плане заказа.
        </p>
        {brief ? (
          <a
            href={whatsapp.href}
            target="_blank"
            rel="noreferrer"
            className="mt-6 flex min-h-12 items-center justify-center gap-2 rounded-control bg-lime px-4 py-3 text-sm font-bold text-ink"
          >
            Обсудить готовый бриф <ArrowRight size={17} aria-hidden="true" />
          </a>
        ) : (
          <button
            type="button"
            disabled
            className="mt-6 w-full rounded-control bg-white/15 p-3 text-sm text-white/70"
          >
            Сначала проверьте поля
          </button>
        )}
        <p className="mt-2 text-micro text-white/70">
          Откроется WhatsApp. Вы проверите сообщение перед отправкой.
        </p>
        <button
          type="button"
          disabled={!brief}
          onClick={copyBrief}
          className="mt-4 min-h-11 w-full rounded-control border border-white/30 px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          Скопировать бриф
        </button>
        <button
          type="button"
          disabled={!brief}
          onClick={continueInAccount}
          className="mt-4 min-h-11 w-full text-sm font-semibold text-white underline decoration-white/40 underline-offset-4 disabled:opacity-50"
        >
          Я уже клиент: открыть заявку
        </button>
        <p className="mt-2 text-micro text-white/70">
          Бриф сохранится в этой вкладке для переноса в кабинет.
        </p>
        <p role="status" aria-live="polite" className="mt-4 text-fine text-lime">
          {status}
        </p>
      </aside>
    </div>
  );
}
