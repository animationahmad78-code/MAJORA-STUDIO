import { describe, expect, it } from 'vitest';
import { formatRialInput } from '../apps/web/src/rial-input';

describe('rial input display', () => {
  it('starts blank and groups Persian and Latin digits consistently', () => {
    expect(formatRialInput('')).toBe('');
    expect(formatRialInput('۱۲۳۴۵۶۷')).toBe('1,234,567');
    expect(formatRialInput('1,234,567')).toBe('1,234,567');
  });

  it('formats exact large integers without floating-point rounding', () => {
    expect(formatRialInput('9007199254740991')).toBe('9,007,199,254,740,991');
  });
});
