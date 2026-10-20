export type Product = { id: string; name: string; category: string; priceRial: number; stock: number; archived?: boolean };
export type PriceEvent = { id: string; batchId: string; productId: string; oldPriceRial: number; newPriceRial: number; at: string; kind: 'raise' | 'undo' };
export type PriceBatch = { id: string; percentBasisPoints: number; at: string; productIds: string[]; sourceBatchId?: string; undoneAt?: string };

export function assertRial(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('مبلغ ریالی نامعتبر است.');
}

export function formatRial(value: number): string {
  assertRial(value);
  return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(value);
}

export function parseRial(input: string): number {
  const normalized = input.replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 1632))
    .replace(/[\s,٬،]/g, '');
  if (!/^\d+$/.test(normalized)) throw new Error('مبلغ را فقط با رقم وارد کنید.');
  const value = Number(normalized);
  assertRial(value);
  return value;
}

export function increasedPrice(priceRial: number, basisPoints: number): number {
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0 || basisPoints > 1_000_000) throw new Error('درصد نامعتبر است.');
  return changedPrice(priceRial, basisPoints);
}

/** Signed basis points: +1000 = +10%, -1000 = -10%. Half-up to one Rial. */
export function changedPrice(priceRial: number, basisPoints: number): number {
  assertRial(priceRial);
  if (!Number.isSafeInteger(basisPoints) || basisPoints < -10_000 || basisPoints > 1_000_000) throw new Error('درصد نامعتبر است.');
  const result = (BigInt(priceRial) * BigInt(10_000 + basisPoints) + 5_000n) / 10_000n;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('مبلغ از سقف قابل محاسبه بیشتر است.');
  return Number(result);
}

export function applyPriceIncrease(products: Product[], selectedIds: string[], basisPoints: number, batchId: string, at: string): { products: Product[]; batch: PriceBatch; events: PriceEvent[] } {
  const selected = new Set(selectedIds);
  const events: PriceEvent[] = [];
  const updated = products.map(p => {
    if (p.archived || !selected.has(p.id)) return p;
    const newPriceRial = increasedPrice(p.priceRial, basisPoints);
    events.push({ id: crypto.randomUUID(), batchId, productId: p.id, oldPriceRial: p.priceRial, newPriceRial, at, kind: 'raise' });
    return { ...p, priceRial: newPriceRial };
  });
  if (!events.length) throw new Error('کالایی برای تغییر انتخاب نشده است.');
  return { products: updated, batch: { id: batchId, percentBasisPoints: basisPoints, at, productIds: events.map(e => e.productId) }, events };
}

export function undoPriceBatch(products: Product[], history: PriceEvent[], batchId: string, undoBatchId: string, at: string): { products: Product[]; events: PriceEvent[]; conflicts: string[] } {
  const source = history.filter(e => e.batchId === batchId && e.kind === 'raise');
  if (!source.length) throw new Error('دستهٔ تغییر قیمت پیدا نشد.');
  const byProduct = new Map(source.map(e => [e.productId, e]));
  const events: PriceEvent[] = [];
  const conflicts: string[] = [];
  const updated = products.map(p => {
    const event = byProduct.get(p.id);
    if (!event) return p;
    if (p.priceRial !== event.newPriceRial) { conflicts.push(p.id); return p; }
    events.push({ id: crypto.randomUUID(), batchId: undoBatchId, productId: p.id, oldPriceRial: p.priceRial, newPriceRial: event.oldPriceRial, at, kind: 'undo' });
    return { ...p, priceRial: event.oldPriceRial };
  });
  return { products: updated, events, conflicts };
}
