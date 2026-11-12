import { describe, expect, it } from 'vitest';
import { promoDateBounds, promoJalaliDate } from '../apps/web/src/promo-dates';

describe('Iranian promotion calendar days', () => {
  it('activates at the beginning of the selected Tehran day and expires after its final second', () => {
    const range = promoDateBounds('۱۴۰۵/۰۸/۲۱', '۱۴۰۵/۰۸/۲۱');
    expect(range.startsAt).toBe('2026-11-11T20:30:00.000Z');
    expect(range.expiresAt).toBe('2026-11-12T20:30:00.000Z');
    expect(promoJalaliDate(range.startsAt)).toBe('1405/08/21');
    expect(promoJalaliDate(range.expiresAt, true)).toBe('1405/08/21');
  });

  it('rejects invalid or reversed dates', () => {
    expect(() => promoDateBounds('۱۴۰۵/۱۲/۳۰', '۱۴۰۵/۱۲/۳۰')).toThrow(/تاریخ/);
    expect(() => promoDateBounds('۱۴۰۵/۰۸/۲۲', '۱۴۰۵/۰۸/۲۱')).toThrow(/بازه/);
  });
});
