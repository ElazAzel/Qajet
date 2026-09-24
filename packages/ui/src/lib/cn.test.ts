import { describe, expect, it } from 'vitest';
import { cn } from './cn';

/**
 * В теме два своих размера шрифта — `text-micro` (11px) и `text-fine` (13px).
 * Без настройки tailwind-merge принимает их за ЦВЕТ текста и выбрасывает, как
 * только рядом появляется настоящий цвет (`text-status-…-fg`, `text-muted`).
 * Так статусная пилюля рендерилась в 16px вместо 13px везде, где родитель не
 * задавал размер.
 */
describe('cn: собственные размеры шрифта', () => {
  it('keeps a custom size next to a text colour', () => {
    expect(cn('text-fine', 'text-status-pending-fg').split(' ')).toEqual([
      'text-fine',
      'text-status-pending-fg',
    ]);
    expect(cn('text-micro text-muted').split(' ')).toEqual(['text-micro', 'text-muted']);
  });

  it('still resolves a real size conflict to the last size', () => {
    expect(cn('text-fine', 'text-sm')).toBe('text-sm');
    expect(cn('text-sm', 'text-micro')).toBe('text-micro');
  });
});
