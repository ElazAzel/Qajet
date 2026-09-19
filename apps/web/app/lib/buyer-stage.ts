import type { StampTone } from '@qajet/ui/motion';
import type { OrderState } from './order-state';

/**
 * Что покупатель видит вместо 17 внутренних состояний заказа — qajet-master-spec.md §10.
 *
 * Внутренние состояния (`OrderState`) остаются машиной состояний для
 * консьержа и базы. Покупателю нужны три ответа: на каком мы этапе, чей
 * сейчас ход и что ему делать. Раньше он видел «RFQ отправлен» и «КП
 * получены» — внутренний жаргон — и ни разу не видел, ждёт ли QAJET его или
 * он QAJET.
 *
 * Функция чистая: то же решение принимают список закупок, страница закупки
 * и тесты. Заявка без заказа (консьерж ещё не взял её в работу) — тоже
 * закупка со своей стадией, а не пустое место.
 */

export type BuyerStageKey =
  | 'received'
  | 'decision'
  | 'sourcing'
  | 'execution'
  | 'acceptance'
  | 'done'
  | 'problem';

export type WaitingOn = 'qajet' | 'buyer' | 'buyer_owner' | 'supplier' | null;

export type NextActionKind =
  | 'pay_prepayment'
  | 'confirm_plan'
  | 'accept_delivery'
  | 'close_order'
  | 'answer_clarification';

export interface NextAction {
  kind: NextActionKind;
  label: string;
}

export interface CaseDescription {
  stage: BuyerStageKey;
  /** Подпись стадии для пилюли. */
  label: string;
  tone: StampTone;
  waitingOn: WaitingOn;
  /** Одна фраза «что сейчас происходит». */
  headline: string;
  nextAction: NextAction | null;
}

export interface CaseInput {
  /** Статус самой заявки — определяет закупку, пока заказа нет. */
  requestStatus: string;
  orderState: OrderState | null;
  /** Руководитель компании покупателя может утверждать план без лимита. */
  isOwner: boolean;
}

const STAGE: Record<BuyerStageKey, { label: string; tone: StampTone }> = {
  received: { label: 'Получено', tone: 'neutral' },
  decision: { label: 'Нужно ваше решение', tone: 'pending' },
  sourcing: { label: 'Подбираем исполнителей', tone: 'progress' },
  execution: { label: 'Исполняем', tone: 'progress' },
  acceptance: { label: 'Нужна приёмка', tone: 'pending' },
  done: { label: 'Завершено', tone: 'success' },
  problem: { label: 'Есть проблема', tone: 'signal' },
};

function make(
  stage: BuyerStageKey,
  waitingOn: WaitingOn,
  headline: string,
  nextAction: NextAction | null = null,
  label?: string,
): CaseDescription {
  const base = STAGE[stage];
  return { stage, label: label ?? base.label, tone: base.tone, waitingOn, headline, nextAction };
}

function describeRequestOnly(status: string): CaseDescription {
  switch (status) {
    case 'needs_clarification':
      return make(
        'decision',
        'buyer',
        'Консьерж просит уточнить детали заявки.',
        { kind: 'answer_clarification', label: 'Ответить консьержу' },
        'Нужны уточнения',
      );
    case 'closed':
      return make('done', null, 'Заявка закрыта.');
    default:
      return make('received', 'qajet', 'Заявка получена — консьерж скоро возьмёт её в работу.');
  }
}

export function describeCase({ requestStatus, orderState, isOwner }: CaseInput): CaseDescription {
  if (!orderState) return describeRequestOnly(requestStatus);

  switch (orderState) {
    case 'draft':
      return make('received', 'qajet', 'Консьерж изучает заявку и готовит оценку стоимости.');
    case 'estimated':
      return make(
        'decision',
        'buyer',
        'Оценка готова. После оплаты счёта на предоплату мы запросим предложения исполнителей.',
        { kind: 'pay_prepayment', label: 'Оплатить счёт на предоплату' },
      );
    case 'prepaid':
    case 'rfq_sent':
    case 'quotes_received':
      return make('sourcing', 'qajet', 'Собираем предложения исполнителей и сравниваем варианты.');
    case 'plan_proposed':
      return make(
        'decision',
        'buyer',
        'Мы подготовили варианты исполнения. Выберите подходящий и утвердите.',
        { kind: 'confirm_plan', label: 'Выбрать вариант и утвердить' },
      );
    case 'awaiting_internal_approval':
      return isOwner
        ? make(
            'decision',
            'buyer_owner',
            'Сумма выше лимита менеджера — план ждёт вашего утверждения.',
            {
              kind: 'confirm_plan',
              label: 'Утвердить план',
            },
          )
        : make(
            'decision',
            'buyer_owner',
            'Сумма выше вашего лимита — план ждёт утверждения руководителя компании.',
          );
    case 'plan_approved':
    case 'suppliers_paid':
      return make('execution', 'qajet', 'План утверждён. Оформляем работу с исполнителями.');
    case 'in_production':
      return make('execution', 'supplier', 'Заказ в производстве.');
    case 'shipped':
      return make('execution', 'supplier', 'Заказ отправлен — ждём подтверждения доставки.');
    case 'delivered':
      return make('acceptance', 'buyer', 'Заказ доставлен. Проверьте его и примите поставку.', {
        kind: 'accept_delivery',
        label: 'Принять поставку',
      });
    case 'accepted':
      return make(
        'acceptance',
        'buyer',
        'Поставка принята. Осталось подтвердить сверку по оплате и закрыть заказ.',
        { kind: 'close_order', label: 'Подтвердить сверку и закрыть' },
      );
    case 'closed':
      return make('done', null, 'Заказ закрыт. Закрывающие документы — ниже.');
    case 'on_hold':
      return make('problem', 'qajet', 'Заказ на паузе: рассматриваем изменение условий.');
    case 'disputed':
      return make('problem', 'qajet', 'Открыт спор по заказу — консьерж свяжется с вами.');
    case 'cancelled':
      return make('problem', null, 'Заказ отменён.', null, 'Отменено');
  }
}

/** Ход за покупателем: такие закупки поднимаются в списке наверх. */
export function isBuyerTurn(description: CaseDescription): boolean {
  return description.waitingOn === 'buyer' || description.waitingOn === 'buyer_owner';
}

const WAITING_LABEL: Record<Exclude<WaitingOn, null>, string> = {
  qajet: 'QAJET',
  buyer: 'Вы',
  buyer_owner: 'Руководитель вашей компании',
  supplier: 'Исполнитель',
};

export function waitingOnLabel(waitingOn: WaitingOn): string | null {
  return waitingOn ? WAITING_LABEL[waitingOn] : null;
}

/** Ссылка следующего шага. Якоря ведут к блокам той же страницы закупки. */
export function hrefForAction(
  kind: NextActionKind,
  ids: { requestId: string; orderId: string | null },
): string {
  const base = `/buyer/requests/${ids.requestId}`;
  switch (kind) {
    case 'confirm_plan':
      return ids.orderId ? `/buyer/orders/${ids.orderId}/confirm` : base;
    case 'pay_prepayment':
      return `${base}#prepayment`;
    case 'accept_delivery':
      return `${base}#accept`;
    case 'close_order':
      return `${base}#close`;
    case 'answer_clarification':
      return '/buyer/messages';
  }
}
