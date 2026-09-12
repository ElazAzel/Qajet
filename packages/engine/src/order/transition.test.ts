import { describe, expect, it } from 'vitest';
import { nextStatesFor, ORDER_TRANSITION_GRAPH, transition } from './transition.js';

describe('transition', () => {
  it('разрешает штатный операционный путь консьержа', () => {
    const chain: Array<[Parameters<typeof transition>[0], Parameters<typeof transition>[1]]> = [
      ['draft', 'estimated'],
      ['estimated', 'prepaid'],
      ['prepaid', 'rfq_sent'],
      ['rfq_sent', 'quotes_received'],
      ['quotes_received', 'plan_proposed'],
    ];
    for (const [from, to] of chain) {
      expect(transition(from, to, 'concierge')).toEqual({ ok: true });
    }
  });

  it('решающие точки — только покупатель', () => {
    expect(transition('plan_proposed', 'plan_approved', 'buyer')).toEqual({ ok: true });
    expect(transition('delivered', 'accepted', 'buyer')).toEqual({ ok: true });
    expect(transition('accepted', 'closed', 'buyer')).toEqual({ ok: true });
  });

  it('концьерж не может утвердить план за покупателя', () => {
    const result = transition('plan_proposed', 'plan_approved', 'concierge');
    expect(result.ok).toBe(false);
  });

  it('покупатель не может продвинуть операционную стадию', () => {
    const result = transition('suppliers_paid', 'in_production', 'buyer');
    expect(result.ok).toBe(false);
  });

  it('admin допущен везде, где допущен concierge', () => {
    for (const [from, edges] of Object.entries(ORDER_TRANSITION_GRAPH)) {
      for (const edge of edges) {
        if (edge.actors.includes('concierge')) {
          expect(transition(from as never, edge.to, 'admin')).toEqual({ ok: true });
        }
      }
    }
  });

  it('несуществующий переход отклоняется с причиной', () => {
    const result = transition('draft', 'closed', 'admin');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('draft → closed');
  });

  it('supplier подтверждает доставку, но не принимает заказ и не закрывает его', () => {
    expect(transition('shipped', 'delivered', 'supplier')).toEqual({ ok: true });
    expect(transition('delivered', 'accepted', 'supplier').ok).toBe(false);
    expect(transition('accepted', 'closed', 'supplier').ok).toBe(false);
  });

  it('closed и cancelled — терминальные состояния без исходящих рёбер', () => {
    expect(ORDER_TRANSITION_GRAPH.closed).toHaveLength(0);
    expect(ORDER_TRANSITION_GRAPH.cancelled).toHaveLength(0);
  });

  it('из каждого нетерминального состояния есть хотя бы один исходящий переход', () => {
    for (const [state, edges] of Object.entries(ORDER_TRANSITION_GRAPH)) {
      if (state === 'closed' || state === 'cancelled') continue;
      expect(edges.length).toBeGreaterThan(0);
    }
  });

  it('nextStatesFor фильтрует по актёру', () => {
    expect(nextStatesFor('plan_proposed', 'buyer').sort()).toEqual(
      ['awaiting_internal_approval', 'cancelled', 'plan_approved'].sort(),
    );
    expect(nextStatesFor('plan_proposed', 'concierge')).toEqual(['cancelled']);
    expect(nextStatesFor('quotes_received', 'concierge')).toEqual(['plan_proposed']);
    expect(nextStatesFor('shipped', 'supplier')).toEqual(['delivered']);
  });

  it('rfq_sent → cancelled допускает и покупателя, и staff (сценарий с возвратом до КП)', () => {
    expect(transition('rfq_sent', 'cancelled', 'buyer')).toEqual({ ok: true });
    expect(transition('rfq_sent', 'cancelled', 'concierge')).toEqual({ ok: true });
  });
  it('спор завершается приёмкой или отменой, но не паузой — иначе заказ уезжает назад по циклу', () => {
    // Ребро disputed → on_hold было дефектом: из on_hold выход только в
    // suppliers_paid, то есть доставленный и оспоренный заказ возвращался к
    // стадии «поставщики оплачены».
    expect(transition('disputed', 'on_hold', 'concierge').ok).toBe(false);
    expect(transition('disputed', 'accepted', 'concierge').ok).toBe(true);
    expect(transition('disputed', 'cancelled', 'concierge').ok).toBe(true);

    // Ни одно состояние не должно уметь уводить заказ назад через паузу:
    // в on_hold можно попасть только оттуда, откуда suppliers_paid ещё
    // впереди.
    for (const [from, edges] of Object.entries(ORDER_TRANSITION_GRAPH)) {
      if (edges.some((e) => e.to === 'on_hold')) {
        expect(from).toBe('plan_approved');
      }
    }
  });
});
