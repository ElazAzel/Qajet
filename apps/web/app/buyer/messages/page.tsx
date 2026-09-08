import { cn } from '@qajet/ui/lib/cn';
import { Reveal } from '@qajet/ui/motion';

/**
 * Сообщения — переписка покупателя с поставщиками по заказам (threads/
 * messages, agents.md §5). Экран визуальный: список тредов слева, открытый
 * тред справа. Реальная отправка и realtime — отдельная фаза, здесь
 * статичная витрина с реалистичными данными.
 */

interface ChatPreview {
  id: string;
  name: string;
  order: string;
  preview: string;
  time: string;
  unread: boolean;
  active?: boolean;
}

const DEFAULT_CHAT: ChatPreview = {
  id: 'uka-print',
  name: 'Uka Print',
  order: 'Мерч для конференции',
  preview: 'Счёт отправлен, проверьте, пожалуйста',
  time: '10:24',
  unread: true,
  active: true,
};

const CHATS: ChatPreview[] = [
  DEFAULT_CHAT,
  {
    id: 'printlab',
    name: 'PrintLab',
    order: 'Welcome Pack',
    preview: 'Макет утверждён, спасибо!',
    time: '09:17',
    unread: false,
  },
  {
    id: 'goodies-kz',
    name: 'Goodies KZ',
    order: 'HR-подарки к Наурызу',
    preview: 'Производство запущено',
    time: 'Вчера',
    unread: true,
  },
  {
    id: 'eventoria',
    name: 'Eventoria',
    order: 'Кейтеринг на открытие офиса',
    preview: 'Заказ доставлен',
    time: 'Вчера',
    unread: false,
  },
  {
    id: 'alma-design',
    name: 'Alma Design',
    order: 'Ежедневники с тиснением',
    preview: 'Ждём вашего подтверждения',
    time: '12 сен',
    unread: true,
  },
];

interface Message {
  text: string;
  mine: boolean;
}

const MESSAGES: Message[] = [
  { text: 'Добрый день! Отправляем счёт по заказу QJ-00112.', mine: false },
  { text: 'Спасибо, посмотрим сегодня.', mine: true },
  { text: 'Счёт оплачен, ждём подтверждения оплаты от вас.', mine: false },
  { text: 'Подтверждаю поступление, можно запускать производство.', mine: true },
  { text: 'Отлично, производство запущено. Ориентир по сроку — 20 сентября.', mine: false },
];

const avatarClass = 'rounded-control bg-page';

export default function BuyerMessagesPage() {
  const activeChat = CHATS.find((c) => c.active) ?? DEFAULT_CHAT;

  return (
    <Reveal>
      <h1 className="mb-5 text-3xl font-extrabold">Сообщения</h1>
      {/* lg, не md: список тредов (320px) появляется вместе с сайдбаром
          оболочки (тоже md:flex, 240px) — на планшете (768px) оба разом
          оставляли треду ~200px, нечитаемо. lg сдвигает точку туда, где
          после сайдбара реально остаётся место для списка И треда. */}
      <div className="grid h-[calc(100vh-260px)] min-h-[520px] grid-cols-1 overflow-hidden rounded-card border border-rule bg-surface lg:grid-cols-[320px_1fr]">
        <div className="hidden flex-col border-rule border-r lg:flex">
          <div className="border-rule border-b p-4">
            <input
              type="search"
              placeholder="Поиск по чатам…"
              className="w-full rounded-control bg-page px-4 py-2.5 text-fine placeholder:text-muted"
            />
          </div>
          <ul className="flex-1 overflow-y-auto">
            {CHATS.map((chat) => (
              <li key={chat.id}>
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-start gap-3 border-rule border-b px-4 py-3.5 text-left',
                    chat.active ? 'bg-page' : 'hover:bg-page/60',
                  )}
                >
                  <span className={cn(avatarClass, 'h-10 w-10 shrink-0')} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-semibold">{chat.name}</span>
                      <span className="shrink-0 text-micro text-muted">{chat.time}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-fine text-muted">{chat.order}</span>
                    <span className="mt-0.5 block truncate text-fine text-muted">
                      {chat.preview}
                    </span>
                  </span>
                  {chat.unread && (
                    <span
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-purple"
                      aria-hidden="true"
                    />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col">
          <div className="flex items-center gap-3 border-rule border-b px-6 py-4">
            <span className={cn(avatarClass, 'h-10 w-10 shrink-0')} aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold">{activeChat.name}</p>
              <p className="text-fine text-muted">{activeChat.order}</p>
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto p-6">
            {MESSAGES.map((m) => (
              <div key={m.text} className={cn('flex', m.mine ? 'justify-end' : 'justify-start')}>
                <p
                  className={cn(
                    'max-w-[60%] rounded-control px-4 py-2.5 text-fine leading-relaxed',
                    m.mine ? 'bg-purple text-white' : 'bg-page text-ink',
                  )}
                >
                  {m.text}
                </p>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 border-rule border-t px-6 py-4">
            <input
              type="text"
              placeholder="Напишите сообщение…"
              className="flex-1 rounded-control bg-page px-4 py-3 text-sm placeholder:text-muted"
            />
            <button
              type="button"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-purple text-white"
              aria-label="Отправить"
            >
              →
            </button>
          </div>
        </div>
      </div>
    </Reveal>
  );
}
