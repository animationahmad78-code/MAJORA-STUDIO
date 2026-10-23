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
});
