import { describe, expect, it } from 'vitest';
import { nextRowIndex } from './keyboard-list-nav';

describe('nextRowIndex', () => {
  it('пустой список — некуда двигаться', () => {
    expect(nextRowIndex(-1, 'j', 0)).toBe(-1);
  });

  it('ничего не сфокусировано — j/k ставят фокус на первую строку', () => {
    expect(nextRowIndex(-1, 'j', 5)).toBe(0);
    expect(nextRowIndex(-1, 'k', 5)).toBe(0);
  });

  it('j двигает вниз на одну строку', () => {
    expect(nextRowIndex(2, 'j', 5)).toBe(3);
  });

  it('k двигает вверх на одну строку', () => {
    expect(nextRowIndex(2, 'k', 5)).toBe(1);
  });

  it('j на последней строке — зажато, дальше некуда', () => {
    expect(nextRowIndex(4, 'j', 5)).toBe(4);
  });

  it('k на первой строке — зажато, дальше некуда', () => {
    expect(nextRowIndex(0, 'k', 5)).toBe(0);
  });

  it('единственная строка в списке — j и k остаются на ней же', () => {
    expect(nextRowIndex(0, 'j', 1)).toBe(0);
    expect(nextRowIndex(0, 'k', 1)).toBe(0);
  });
});
