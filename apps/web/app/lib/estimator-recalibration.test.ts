import { describe, expect, it } from 'vitest';
import { appendEstimatorError, itemKeyForEstimator } from './estimator-recalibration';

describe('estimator recalibration helpers', () => {
  it('добавляет ошибку во все позиции заказа и сохраняет окно истории', () => {
    const result = appendEstimatorError(
      [
        { category: 'tshirt-logo', relativeErrors: [0.1, 0.2] },
        { category: 'booklet-a5', relativeErrors: [0.3] },
        { category: 'unused', relativeErrors: [0.4] },
      ],
      ['tshirt-logo', 'booklet-a5', 'tshirt-logo'],
      0.5,
      2,
    );

    expect(result.get('tshirt-logo')).toEqual([0.2, 0.5]);
    expect(result.get('booklet-a5')).toEqual([0.3, 0.5]);
    expect(result.get('unused')).toEqual([0.4]);
  });

  it('берёт itemKey из specs и безопасно откатывается к категории', () => {
    expect(itemKeyForEstimator({ itemKey: 'hoodie-embroidery' }, 'merch')).toBe(
      'hoodie-embroidery',
    );
    expect(itemKeyForEstimator({ itemKey: '' }, 'merch')).toBe('merch');
    expect(itemKeyForEstimator(null, 'printing')).toBe('printing');
  });
});
