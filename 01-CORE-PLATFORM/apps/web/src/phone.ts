export function normalizedIranPhone(value: string): string | null {
  if (!value.trim()) return '';
  const digits = value.replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 1632));
  if (/[^\d\s()-]/.test(digits)) return null;
  const compact = digits.replace(/[\s()-]/g, '');
  return /^0[1-9]\d{9}$/.test(compact) ? compact : null;
}
