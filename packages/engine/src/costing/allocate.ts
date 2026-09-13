import type { Kzt } from '../money/index.js';
import { distributeProportionally, percentOfKzt, sumKzt } from '../money/index.js';

export interface SupplierCostLineInput {
  requestItemId: string;
  offerId: string;
  supplierId: string;
  qty: number;
  productNetKzt: Kzt;
  setupFeeKzt: Kzt;
}

export interface SupplierCostLine extends SupplierCostLineInput {
  setupAllocationKzt: Kzt;
  lineTotalKzt: Kzt;
}

export interface SupplierCostAllocation {
  productSubtotalKzt: Kzt;
  setupFeeKzt: Kzt;
  totalSupplierKzt: Kzt;
  lines: SupplierCostLine[];
  /** Suppliers whose selected offers disagree about the one setup fee to use. */
  ambiguousSupplierIds: string[];
}

/**
 * Reconciles supplier costs before they enter a plan.
 *
 * A setup fee belongs to a supplier engagement, not to every selected line.
 * It is therefore allocated once per supplier across that supplier's lines.
 * The allocation is deterministic (largest-remainder method) and leaves the
 * persisted line totals exactly equal to the aggregate supplier subtotal.
 */
export function allocateSupplierCosts(
  inputs: readonly SupplierCostLineInput[],
): SupplierCostAllocation {
  const bySupplier = new Map<string, SupplierCostLineInput[]>();
  for (const input of inputs) {
    if (!Number.isSafeInteger(input.productNetKzt) || input.productNetKzt < 0) {
      throw new Error('Стоимость позиции поставщика должна быть неотрицательным целым числом');
    }
    if (!Number.isSafeInteger(input.setupFeeKzt) || input.setupFeeKzt < 0) {
      throw new Error('Стоимость подготовки должна быть неотрицательным целым числом');
    }
    const lines = bySupplier.get(input.supplierId);
    if (lines) lines.push(input);
    else bySupplier.set(input.supplierId, [input]);
  }

  const setupBySupplier = new Map<string, Kzt>();
  const ambiguousSupplierIds: string[] = [];
  for (const [supplierId, lines] of bySupplier) {
    const setupValues = [...new Set(lines.map((line) => line.setupFeeKzt))];
    const setupFeeKzt = Math.max(...setupValues, 0);
    setupBySupplier.set(supplierId, setupFeeKzt);
    if (setupValues.length > 1) ambiguousSupplierIds.push(supplierId);
  }

  const allocatedLines: SupplierCostLine[] = [];
  for (const [supplierId, lines] of bySupplier) {
    const setupAllocations = distributeProportionally(
      setupBySupplier.get(supplierId) ?? 0,
      lines.map((line) => line.productNetKzt),
    );
    lines.forEach((line, index) => {
      const setupAllocationKzt = setupAllocations[index] ?? 0;
      allocatedLines.push({
        ...line,
        setupAllocationKzt,
        lineTotalKzt: line.productNetKzt + setupAllocationKzt,
      });
    });
  }

  const productSubtotalKzt = sumKzt(inputs.map((line) => line.productNetKzt));
  const setupFeeKzt = sumKzt([...setupBySupplier.values()]);
  const totalSupplierKzt = sumKzt(allocatedLines.map((line) => line.lineTotalKzt));

  return {
    productSubtotalKzt,
    setupFeeKzt,
    totalSupplierKzt,
    lines: allocatedLines,
    ambiguousSupplierIds,
  };
}

/**
 * Allocates the already rounded aggregate commission to plan lines. This is
 * deliberately separate from `percentOfKzt(line)` because independently
 * rounded line percentages can differ from the plan aggregate by a tenge.
 */
export function allocateCommission(
  totalSupplierKzt: Kzt,
  commissionRatePct: number,
  lineTotalsKzt: readonly Kzt[],
): Kzt[] {
  if (sumKzt(lineTotalsKzt) !== totalSupplierKzt) {
    throw new Error('Строки поставщика не сходятся с итогом поставщика');
  }
  return distributeProportionally(percentOfKzt(totalSupplierKzt, commissionRatePct), lineTotalsKzt);
}
