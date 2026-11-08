import { describe, expect, it } from 'vitest';
import { discountedLineRial, percentThousandths } from '../apps/web/src/invoice-quote';

describe('invoice selective discount', () => {
  it('accepts Persian digits and at most three decimal places', () => {
    expect(percentThousandths('۱۲٫۵')).toBe(12500);
    expect(percentThousandths('٣٣.٣٣٣')).toBe(33333);
    expect(percentThousandths('100.001')).toBeNull();
    expect(percentThousandths('12.1234')).toBeNull();
    expect(percentThousandths('-1')).toBeNull();
  });

  it('rounds each selected line once to whole Rial, matching the server', () => {
    expect(discountedLineRial(1001, 3, 33333)).toBe(2002);
    expect(discountedLineRial(1001, 1, 12500)).toBe(876);
    expect(discountedLineRial(1001, 1, 0)).toBe(1001);
    expect(discountedLineRial(1001, 1, 100000)).toBe(0);
  });
});
