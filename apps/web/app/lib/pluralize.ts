/**
 * Русское склонение по числу (1/2-4/5+ формы) — `n === 1 ? 'а' : 'б'` даёт
 * неверную форму для 0 и для 5+ («0 поставщика», «11 поставщик»).
 */
export function pluralizeRu(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function supplierCountLabel(count: number): string {
  return pluralizeRu(count, 'поставщик', 'поставщика', 'поставщиков');
}
