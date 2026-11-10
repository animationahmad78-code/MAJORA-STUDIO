import { describe, expect, it } from 'vitest';
import { normalizedIranPhone } from '../apps/web/src/phone';

describe('Iranian contact phone', () => {
  it('keeps a blank optional number blank and normalizes local digits', () => {
    expect(normalizedIranPhone('')).toBe('');
    expect(normalizedIranPhone('۰۹۱۰-۵۰۰-۳۶۶۹')).toBe('09105003669');
    expect(normalizedIranPhone('٠٥١ ٣٣٦٦٢٧٩٤')).toBe('05133662794');
  });
  it('rejects short and malformed numbers', () => {
    expect(normalizedIranPhone('0912000000')).toBeNull();
    expect(normalizedIranPhone('00120000000')).toBeNull();
    expect(normalizedIranPhone('0912000000a')).toBeNull();
  });
});
