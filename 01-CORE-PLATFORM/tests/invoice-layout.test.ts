import { describe, expect, it } from 'vitest';
import { pageLines } from '../apps/mobile/src/invoice-document';

describe('invoice pagination', () => {
  it('keeps every product exactly once and reserves the last page for terms', () => {
    const rows = Array.from({ length: 31 }, (_, index) => ({ name: `کیف مدل ${index} با توضیح رنگ و جنس و جزئیات فروشگاهی` }));
    for (const paper of ['a4', 'a5'] as const) {
      const pages = pageLines(rows, paper);
      expect(pages.length).toBeGreaterThan(1);
      expect(pages.flat()).toEqual(rows);
      expect(pages.at(-1)?.length).toBeLessThan(pages[0].length);
    }
  });
  it('balances eighteen A4 rows instead of leaving one row alone on the last sheet', () => {
    const rows = Array.from({ length: 18 }, (_, index) => ({ name: `قلم شماره ${index + 1}` }));
    const pages = pageLines(rows, 'a4');
    expect(pages).toHaveLength(2);
    expect(pages.map(page => page.length)).toEqual([9, 9]);
    expect(pages.flat()).toEqual(rows);
  });
});
