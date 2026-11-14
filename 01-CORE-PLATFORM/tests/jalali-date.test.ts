import { describe, expect, it } from 'vitest';
import { dateNotice, daysInJalaliMonth, isoToJalaliDate, jalaliToIsoDate, parseJalali } from '../apps/mobile/src/jalali-date';

describe('Jalali date picker rules', () => {
  it('limits days by month and leap year', () => {
    expect(daysInJalaliMonth(1405, 1)).toBe(31);
    expect(daysInJalaliMonth(1405, 7)).toBe(30);
    expect(daysInJalaliMonth(1405, 12)).toBe(29);
    expect(daysInJalaliMonth(1403, 12)).toBe(30);
    expect(parseJalali('۱۴۰۵/۰۷/۳۱')).toBeNull();
    expect(parseJalali('۱۴۰۵/۰۷/۳۰')).toEqual([1405, 7, 30]);
  });
  it('warns for a Friday and a listed 1405 national holiday', () => {
    expect(dateNotice('۱۴۰۵/۰۱/۰۷')).toContain('جمعه');
    expect(dateNotice('۱۴۰۵/۱۱/۲۲')).toContain('انقلاب');
    expect(dateNotice('۱۴۰۵/۰۱/۲۵')).toContain('جعفر');
  });
  it('converts valid entered Jalali dates to ISO without shifting the day', () => {
    expect(jalaliToIsoDate('۱۴۰۵/۰۸/۱۷')).toBe('2026-11-08');
    expect(isoToJalaliDate('2026-11-08')).toBe('1405/08/17');
    expect(jalaliToIsoDate('۱۴۰۳/۱۲/۳۰')).toBe('2025-03-20');
    expect(jalaliToIsoDate('۱۴۰۵/۱۲/۳۰')).toBeNull();
  });
});
