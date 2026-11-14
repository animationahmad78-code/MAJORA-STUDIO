import { describe, expect, it } from 'vitest';
import { invoiceRevisionMoney } from '../apps/web/src/invoice-revision-money';

const row = (price: string, quantity: string, discount = '') => ({ price, quantity, discount });

describe('invoice revision money', () => {
  it('calculates gross and discount exactly when the intermediate gross exceeds the safe JSON integer', () => {
    const result = invoiceRevisionMoney([row('3002399751580331', '3', '3')], 0n);
    expect(result).toEqual({ lineTotals: [9007199254740990n], totalRial: 9007199254740990n, error: null });
    expect(3002399751580331 * 3 - 3).not.toBe(Number(result.totalRial));
  });

  it('rejects an unsafe total and a discount greater than its own row', () => {
    expect(invoiceRevisionMoney([row('9007199254740991', '1'), row('1', '1')], 0n).error).toMatch(/جمع اصلاح‌شده/);
    expect(invoiceRevisionMoney([row('100', '1', '101')], 0n).error).toMatch(/تخفیف ردیف/);
  });

  it('checks server overflow, JSON precision, quantity, and already received money', () => {
    expect(invoiceRevisionMoney([row('9007199254740992', '1')], 0n).error).toMatch(/ارسال دقیق/);
    expect(invoiceRevisionMoney([row('9007199254740991', '1000000')], 0n).error).toMatch(/سرور/);
    expect(invoiceRevisionMoney([row('50', '0')], 0n).error).toMatch(/تعداد/);
    expect(invoiceRevisionMoney([row('50', '1')], 51n).error).toMatch(/وجه دریافتی/);
  });
});
