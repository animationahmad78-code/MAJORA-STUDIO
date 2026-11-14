import { describe, expect, it } from 'vitest';
import { formatBigRial, purchaseMoney } from '../apps/web/src/purchase-money';

const row = (unitCostRial: string, quantity = 1, productId = 'existing', priceRial = '') =>
  ({ productId, unitCostRial, quantity, priceRial });

describe('purchase amounts before JSON transport', () => {
  it('sums exactly and accepts a payment within the purchase total', () => {
    const result = purchaseMoney([row('9007199254740000'), row('991')], '9007199254740991');
    expect(result).toEqual({ totalRial: 9007199254740991n, error: null });
    expect(formatBigRial(result.totalRial)).toBe('۹٬۰۰۷٬۱۹۹٬۲۵۴٬۷۴۰٬۹۹۱ ریال');
  });

  it('rejects totals that Number would silently round', () => {
    const result = purchaseMoney([row('9007199254740991'), row('1')], '');
    expect(result.totalRial).toBe(9007199254740992n);
    expect(result.error).toMatch(/جمع خرید/);
  });

  it('rejects an oversized unit price, new product price, and excess payment', () => {
    expect(purchaseMoney([row('9007199254740992')], '').error).toMatch(/فی خرید/);
    expect(purchaseMoney([row('1', 1, 'new', '9007199254740992')], '').error).toMatch(/قیمت فروش/);
    expect(purchaseMoney([row('100')], '101').error).toMatch(/پرداخت‌شده/);
    expect(purchaseMoney([row('')], '').error).toMatch(/صفر را صریح/);
  });
});
