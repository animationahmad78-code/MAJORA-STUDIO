import { describe, expect, it } from 'vitest';
import { applyPriceIncrease, changedPrice, increasedPrice, parseRial, undoPriceBatch, type Product } from '../packages/domain/src/index';

const product: Product = { id: 'a', name: 'کیف', category: 'کیف', priceRial: 1001, stock: 2 };
describe('ریال و تغییر گروهی', () => {
  it('رقم فارسی و جداکننده را می‌خواند', () => expect(parseRial('۱٬۲۳۴٬۵۶۷')).toBe(1234567));
  it('درصد را با گردکردن ریال محاسبه می‌کند', () => expect(increasedPrice(1001, 1000)).toBe(1101));
  it('کاهش دقیق درصدی را نیز پشتیبانی می‌کند', () => expect(changedPrice(12_500_000, -1000)).toBe(11_250_000));
  it('بازگردانی تغییر مستقل بعدی را حذف نمی‌کند', () => {
    const first = applyPriceIncrease([product], ['a'], 1000, 'b1', '2026-10-20');
    const later = [{ ...first.products[0], priceRial: 9999 }];
    const result = undoPriceBatch(later, first.events, 'b1', 'b2', '2026-10-21');
    expect(result.conflicts).toEqual(['a']);
    expect(result.products[0].priceRial).toBe(9999);
  });
});
