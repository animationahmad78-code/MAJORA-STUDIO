import { describe, expect, it } from 'vitest';
import { dateNotice, daysInJalaliMonth, parseJalali } from '../apps/mobile/src/jalali-date';

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
});
