import { describe, expect, it } from 'vitest';
import { buildDashboard } from '../apps/mobile/src/dashboard';
import type { InvoiceHistoryEntry } from '../packages/database/src/index';

const at = new Date(2026, 9, 22, 12).toISOString();
const invoice = (id: string, status: 'issued' | 'void', totalRial: number, quantity: number): InvoiceHistoryEntry => ({
  status, receipt: { id, number: Number(id), at, customerName: 'مریم', lines: [{ productId: 'bag', name: 'کیف', quantity, unitPriceRial: 1000, totalRial }], totalRial }
});

describe('dashboard accounting', () => {
  it('includes archived issued invoices exactly once and excludes void invoices', () => {
    const result = buildDashboard([invoice('1', 'issued', 1800, 2), invoice('1', 'issued', 1800, 2), invoice('2', 'void', 9000, 9)],
      [{ id: 'bag', name: 'کیف', category: 'کیف/دستی', priceRial: 1000, stock: 2 }],
      [{ id: 'c1', name: 'مریم', firstName: 'مریم', lastName: '', phone: '', invoiceCount: 1, lastPurchaseAt: at, createdAt: at }],
      'day', new Date(2026, 9, 22, 14));
    expect(result).toMatchObject({ revenueRial: 1800, invoiceCount: 1, itemsSold: 2, newCustomers: 1, averageInvoiceRial: 1800 });
    expect(result.topProducts).toMatchObject([{ name: 'کیف', units: 2, revenueRial: 1800 }]);
    expect(result.inventory).toMatchObject([{ category: 'کیف', units: 2, products: 1, lowOrEmpty: 1 }]);
  });
});
