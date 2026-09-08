import { describe, expect, it } from 'vitest';
import { checkRequestCompleteness } from './check.js';

const okItem = {
  id: 'item-1',
  name: 'Футболка с логотипом',
  needsClarification: false,
  clarificationReason: null,
};

describe('checkRequestCompleteness', () => {
  it('без дедлайна — блокер, объясняющий причину', () => {
    const result = checkRequestCompleteness({
      deadlineDate: null,
      budgetKzt: 500_000,
      items: [okItem],
    });
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0]?.code).toBe('missing_deadline');
    expect(result.warnings).toHaveLength(0);
  });

  it('со всеми обязательными полями — без блокеров и предупреждений', () => {
    const result = checkRequestCompleteness({
      deadlineDate: '2026-10-20',
      budgetKzt: 500_000,
      items: [okItem],
    });
    expect(result.blockers).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('без бюджета — только предупреждение, не блокер', () => {
    const result = checkRequestCompleteness({
      deadlineDate: '2026-10-20',
      budgetKzt: null,
      items: [okItem],
    });
    expect(result.blockers).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.code).toBe('missing_budget');
  });

  it('позиция, требующая уточнения — блокер с человеческой причиной', () => {
    const result = checkRequestCompleteness({
      deadlineDate: '2026-10-20',
      budgetKzt: 500_000,
      items: [
        {
          id: 'item-2',
          name: 'Позиция после разделения',
          needsClarification: true,
          clarificationReason: 'Проверьте характеристики перед RFQ',
        },
      ],
    });
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0]?.code).toBe('item_needs_clarification');
    expect(result.blockers[0]?.humanReason).toContain('Проверьте характеристики перед RFQ');
  });

  it('несколько блокеров одновременно — все возвращаются', () => {
    const result = checkRequestCompleteness({
      deadlineDate: null,
      budgetKzt: null,
      items: [
        { id: 'item-3', name: 'A', needsClarification: true, clarificationReason: null },
        { id: 'item-4', name: 'B', needsClarification: true, clarificationReason: 'причина Б' },
      ],
    });
    expect(result.blockers).toHaveLength(3);
    expect(result.warnings).toHaveLength(1);
  });
});
