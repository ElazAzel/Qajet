import { describe, expect, it } from 'vitest';
import {
  type BuyerStageKey,
  describeCase,
  hrefForAction,
  isBuyerTurn,
  waitingOnLabel,
} from './buyer-stage';
import type { OrderState } from './order-state';

const ALL_STATES: OrderState[] = [
  'draft',
  'estimated',
  'prepaid',
  'rfq_sent',
  'quotes_received',
  'plan_proposed',
  'plan_approved',
  'suppliers_paid',
  'in_production',
  'shipped',
  'delivered',
  'accepted',
  'closed',
  'awaiting_internal_approval',
  'on_hold',
  'cancelled',
  'disputed',
];

const describeAll = (isOwner = true) =>
  ALL_STATES.map((state) => ({
    state,
    d: describeCase({ requestStatus: 'submitted', orderState: state, isOwner }),
  }));

describe('describeCase', () => {
  it('сводит все 17 внутренних состояний к семи стадиям', () => {
    const stages = new Set<BuyerStageKey>(describeAll().map(({ d }) => d.stage));
    expect([...stages].sort()).toEqual(
      ['acceptance', 'decision', 'done', 'execution', 'problem', 'received', 'sourcing'].sort(),
    );
  });

  it('у каждого состояния есть понятная фраза и нет внутреннего жаргона', () => {
    for (const { state, d } of describeAll()) {
      expect(d.headline.length, state).toBeGreaterThan(10);
      expect(`${d.label} ${d.headline}`, state).not.toMatch(/RFQ|КП |rfq_sent|quotes_received/);
    }
  });

  it('следующее действие есть ровно там, где ход за покупателем', () => {
    for (const { state, d } of describeAll()) {
      if (d.waitingOn === 'buyer') expect(d.nextAction, state).not.toBeNull();
      if (d.waitingOn !== 'buyer' && d.waitingOn !== 'buyer_owner') {
        expect(d.nextAction, state).toBeNull();
      }
    }
  });

  it('называет конкретное действие на решающих стадиях', () => {
    const kind = (state: OrderState) =>
      describeCase({ requestStatus: 'submitted', orderState: state, isOwner: true }).nextAction
        ?.kind;
    expect(kind('estimated')).toBe('pay_prepayment');
    expect(kind('plan_proposed')).toBe('confirm_plan');
    expect(kind('delivered')).toBe('accept_delivery');
    expect(kind('accepted')).toBe('close_order');
  });

  it('менеджер сверх лимита ждёт руководителя и не получает кнопку утверждения', () => {
    const manager = describeCase({
      requestStatus: 'submitted',
      orderState: 'awaiting_internal_approval',
      isOwner: false,
    });
    expect(manager.waitingOn).toBe('buyer_owner');
    expect(manager.nextAction).toBeNull();
    const owner = describeCase({
      requestStatus: 'submitted',
      orderState: 'awaiting_internal_approval',
      isOwner: true,
    });
    expect(owner.nextAction?.kind).toBe('confirm_plan');
  });

  it('заявка без заказа — тоже закупка со стадией', () => {
    const fresh = describeCase({ requestStatus: 'submitted', orderState: null, isOwner: true });
    expect(fresh).toMatchObject({ stage: 'received', waitingOn: 'qajet', nextAction: null });
    const clarify = describeCase({
      requestStatus: 'needs_clarification',
      orderState: null,
      isOwner: true,
    });
    expect(clarify).toMatchObject({ stage: 'decision', waitingOn: 'buyer' });
    expect(clarify.nextAction?.kind).toBe('answer_clarification');
  });

  it('отменённый заказ подписан «Отменено», а не «Есть проблема»', () => {
    const d = describeCase({ requestStatus: 'submitted', orderState: 'cancelled', isOwner: true });
    expect(d.label).toBe('Отменено');
    expect(d.stage).toBe('problem');
  });
});

describe('isBuyerTurn / waitingOnLabel / hrefForAction', () => {
  it('поднимает наверх только закупки с ходом покупателя', () => {
    const turn = describeCase({ requestStatus: 'x', orderState: 'delivered', isOwner: true });
    const wait = describeCase({ requestStatus: 'x', orderState: 'in_production', isOwner: true });
    expect(isBuyerTurn(turn)).toBe(true);
    expect(isBuyerTurn(wait)).toBe(false);
  });

  it('подписывает, кого ждём, не раскрывая исполнителя по имени', () => {
    expect(waitingOnLabel('supplier')).toBe('Исполнитель');
    expect(waitingOnLabel('qajet')).toBe('QAJET');
    expect(waitingOnLabel(null)).toBeNull();
  });

  it('ведёт на страницу закупки, а утверждение — на экран подтверждения заказа', () => {
    const ids = { requestId: 'r1', orderId: 'o1' };
    expect(hrefForAction('confirm_plan', ids)).toBe('/buyer/orders/o1/confirm');
    expect(hrefForAction('accept_delivery', ids)).toBe('/buyer/requests/r1#accept');
    expect(hrefForAction('confirm_plan', { requestId: 'r1', orderId: null })).toBe(
      '/buyer/requests/r1',
    );
  });
});
