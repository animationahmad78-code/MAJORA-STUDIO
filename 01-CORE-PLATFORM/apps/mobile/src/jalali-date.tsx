import { useEffect, useRef, useState } from 'react';
import './jalali-date.css';

const digits = (value: string) => value.replace(/[۰-۹]/g, char => String(char.charCodeAt(0) - 1776)).replace(/[٠-٩]/g, char => String(char.charCodeAt(0) - 1632));
const months = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const fixedHolidays: Record<string, string> = {
  '01/01': 'آغاز نوروز', '01/02': 'تعطیلات نوروز', '01/03': 'تعطیلات نوروز', '01/04': 'تعطیلات نوروز',
  '01/12': 'روز جمهوری اسلامی', '01/13': 'روز طبیعت', '03/14': 'رحلت امام خمینی',
  '03/15': 'قیام ۱۵ خرداد', '11/22': 'پیروزی انقلاب اسلامی', '12/29': 'ملی شدن صنعت نفت'
};
// 1405 annual religious dates are reviewed against the published 1405 national calendar.
// Future lunar holidays are deliberately not predicted: their official dates can move.
const annual1405: Record<string, string> = {
  '01/01': 'عید فطر', '01/02': 'تعطیل عید فطر', '01/25': 'شهادت امام جعفر صادق',
  '03/06': 'عید قربان', '03/14': 'عید غدیر', '04/03': 'تاسوعا', '04/04': 'عاشورا',
  '05/13': 'اربعین', '05/21': 'رحلت پیامبر و شهادت امام حسن', '05/22': 'شهادت امام رضا',
  '05/30': 'شهادت امام حسن عسکری', '06/08': 'میلاد پیامبر و امام صادق',
  '08/22': 'شهادت حضرت فاطمه', '10/02': 'میلاد امام علی', '10/16': 'مبعث پیامبر',
  '11/04': 'نیمهٔ شعبان', '12/09': 'شهادت امام علی', '12/19': 'عید فطر', '12/20': 'تعطیل عید فطر'
};
const pad = (value: number | string) => String(value).padStart(2, '0');
const parts = new Intl.DateTimeFormat('en-US-u-ca-persian', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
function persianParts(date: Date): [number, number, number] {
  const map = Object.fromEntries(parts.formatToParts(date).map(item => [item.type, Number(item.value)]));
  return [map.year, map.month, map.day];
}
function firstDay(year: number): Date {
  for (let date = 19; date <= 23; date += 1) {
    const candidate = new Date(Date.UTC(year + 621, 2, date));
    const [y, m, d] = persianParts(candidate);
    if (y === year && m === 1 && d === 1) return candidate;
  }
  throw new Error('سال شمسی پشتیبانی نمی‌شود.');
}
export function daysInJalaliMonth(year: number, month: number): number {
  if (month < 1 || month > 12) return 0;
  if (month <= 6) return 31;
  if (month <= 11) return 30;
  return (firstDay(year + 1).getTime() - firstDay(year).getTime()) / 86400000 === 366 ? 30 : 29;
}
export function parseJalali(value: string): [number, number, number] | null {
  const match = digits(value).trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  return year >= 1300 && year <= 1500 && day >= 1 && day <= daysInJalaliMonth(year, month) ? [year, month, day] : null;
}
export function dateNotice(value: string): string {
  const date = parseJalali(value);
  if (!date) return '';
  const [year, month, day] = date;
  const key = `${pad(month)}/${pad(day)}`;
  const holiday = [fixedHolidays[key], year === 1405 ? annual1405[key] : undefined].filter(Boolean).join('، ');
  const offset = Array.from({ length: month - 1 }, (_, index) => daysInJalaliMonth(year, index + 1)).reduce((a, b) => a + b, 0) + day - 1;
  const friday = new Date(firstDay(year).getTime() + offset * 86400000).getUTCDay() === 5;
  return holiday || friday ? `${friday ? 'جمعه و روز غیرکاری' : 'تعطیل رسمی'}${holiday ? ` · ${holiday}` : ''}` : '';
}
const currentYear = Number(persianParts(new Date())[0]);
type Props = { label: string; value: string; onChange: (value: string) => void; optional?: boolean; id?: string };
export function JalaliDateField({ label, value, onChange, optional = false, id }: Props) {
  const parsed = parseJalali(value);
  const initial = digits(value).split('/');
  const [day, setDay] = useState(parsed ? pad(parsed[2]) : initial[2] ?? '');
  const [month, setMonth] = useState(parsed ? pad(parsed[1]) : initial[1] ?? '');
  const [year, setYear] = useState(parsed ? String(parsed[0]) : initial[0] ?? '');
  const [dismissed, setDismissed] = useState('');
  const [warningModal, setWarningModal] = useState('');
  const lastWarningDate = useRef('');
  const dayRef = useRef<HTMLInputElement>(null), monthRef = useRef<HTMLInputElement>(null), yearRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const sections = digits(value).split('/');
    setYear(sections[0] ?? ''); setMonth(sections[1] ?? ''); setDay(sections[2] ?? '');
  }, [value]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const commit = (nextDay: string, nextMonth: string, nextYear: string) => {
    if (!nextDay && !nextMonth && !nextYear) { onChange(''); return; }
    const next = `${nextYear}/${nextMonth}/${nextDay}`;
    onChange(next);
    const warning = dateNotice(next);
    if (warning && next !== lastWarningDate.current) { lastWarningDate.current = next; setWarningModal(warning); }
  };
  const chooseDay = (raw: string) => { const nextYear = year || String(currentYear); setDay(raw); setYear(nextYear); commit(raw, month, nextYear); };
  const chooseMonth = (raw: string) => {
    const nextYear = year || String(currentYear);
    const max = raw ? daysInJalaliMonth(Number(nextYear), Number(raw)) : 31;
    const nextDay = Number(day) > max ? '' : day;
    setMonth(raw); setDay(nextDay); setYear(nextYear); commit(nextDay, raw, nextYear);
  };
  const chooseYear = (raw: string) => { setYear(raw); commit(day, month, raw); };
  const handleSegment = (part: 'day' | 'month' | 'year', raw: string) => {
    const numeric = digits(raw).replace(/\D/g, '').slice(0, part === 'year' ? 4 : 2);
    if (timer.current) clearTimeout(timer.current);
    if (part === 'year') { chooseYear(numeric); return; }
    if (part === 'day') chooseDay(numeric); else chooseMonth(numeric);
    const next = part === 'day' ? monthRef : yearRef;
    const limit = part === 'day' ? 3 : 1;
    if (numeric.length === 2 || (numeric.length === 1 && Number(numeric) > limit)) next.current?.focus();
    else if (numeric.length === 1) timer.current = setTimeout(() => {
      if (part === 'day') chooseDay(pad(numeric)); else chooseMonth(pad(numeric));
      next.current?.focus();
    }, 650);
  };
  const notice = dateNotice(value);
  const maxDay = month ? daysInJalaliMonth(Number(year || currentYear), Number(month)) : 31;
  const years = Array.from({ length: 11 }, (_, index) => currentYear - 5 + index);
  return <div className="jalali-field" id={id}>
    <span className="jalali-label">{label}{optional && <small>اختیاری</small>}</span>
    <div className="jalali-segments" dir="ltr" onClick={event => { if (event.target === event.currentTarget) dayRef.current?.focus(); }}>
      <input ref={yearRef} aria-label={`${label}: سال`} inputMode="numeric" value={year} placeholder="۱۴۰۵" maxLength={4} onChange={event => handleSegment('year', event.target.value)}/>
      <span>/</span><input ref={monthRef} aria-label={`${label}: ماه`} inputMode="numeric" value={month} placeholder="ماه" maxLength={2} onChange={event => handleSegment('month', event.target.value)}/>
      <span>/</span><input ref={dayRef} aria-label={`${label}: روز`} inputMode="numeric" value={day} placeholder="روز" maxLength={2} onChange={event => handleSegment('day', event.target.value)}/>
    </div>
    <div className="jalali-pickers" dir="rtl">
      <select aria-label={`${label}: انتخاب ماه`} value={month} onChange={event => chooseMonth(event.target.value)}><option value="">ماه</option>{months.map((name, index) => <option key={name} value={pad(index + 1)}>{name}</option>)}</select>
      <select aria-label={`${label}: انتخاب روز`} value={day} disabled={!month} onChange={event => chooseDay(event.target.value)}><option value="">روز</option>{Array.from({ length: maxDay }, (_, index) => <option key={index} value={pad(index + 1)}>{index + 1}</option>)}</select>
      <select aria-label={`${label}: انتخاب سال`} value={year} onChange={event => chooseYear(event.target.value)}><option value="">سال</option>{years.map(item => <option key={item} value={item}>{item}</option>)}</select>
      {optional && <button type="button" title="پاک کردن تاریخ" aria-label={`پاک کردن ${label}`} onClick={() => { setDay(''); setMonth(''); setYear(''); onChange(''); }}>×</button>}
    </div>
    {value && !parsed && <small className="jalali-error">تاریخ کامل و معتبر وارد کنید؛ ترتیب نمایش سال / ماه / روز است.</small>}
    {notice && notice !== dismissed && <div className="jalali-warning" role="alert"><span>این تاریخ {notice} است. برای سررسید، روز کاری را بررسی کنید.</span><button type="button" aria-label="بستن هشدار" onClick={() => setDismissed(notice)}>×</button></div>}
    {warningModal && <div className="jalali-modal-backdrop" role="presentation"><section className="jalali-modal" role="alertdialog" aria-modal="true" aria-label="هشدار روز غیرکاری"><strong>روز غیرکاری</strong><p>تاریخ انتخاب‌شده {warningModal} است. اگر سررسید چک یا پرداخت است، روز کاری بانک را بررسی کنید.</p><button type="button" onClick={() => setWarningModal('')}>متوجه شدم</button></section></div>}
    {parsed && Number(year) !== 1405 && <small className="jalali-caveat">تعطیلات قمری این سال هنوز در تقویم آفلاین تأیید نشده‌اند.</small>}
  </div>;
}
