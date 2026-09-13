import type { Kzt } from '../money/index.js';

export type SettlementKind = 'refund' | 'surcharge' | 'exact';

export interface Settlement {
  kind: SettlementKind;
  /** Absolute remainder. Refunds and surcharges are never negative here. */
  amountKzt: Kzt;
}

function assertMoney(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} должна быть неотрицательным целым числом`);
  }
}

/** Calculates the settlement from immutable agreement and recorded payments. */
export function calculateSettlement(finalAgreedKzt: Kzt, netReceivedKzt: Kzt): Settlement {
  assertMoney(finalAgreedKzt, 'Согласованная стоимость');
  assertMoney(netReceivedKzt, 'Чистые поступления');

  if (netReceivedKzt > finalAgreedKzt) {
    return { kind: 'refund', amountKzt: netReceivedKzt - finalAgreedKzt };
  }
  if (netReceivedKzt < finalAgreedKzt) {
    return { kind: 'surcharge', amountKzt: finalAgreedKzt - netReceivedKzt };
  }
  return { kind: 'exact', amountKzt: 0 };
}
