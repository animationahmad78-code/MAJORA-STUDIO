import { jalaliToIsoDate } from '../../mobile/src/jalali-date';

const tehranClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});
const tehranPersian = new Intl.DateTimeFormat('en-US-u-ca-persian', {
  timeZone: 'Asia/Tehran', year: 'numeric', month: 'numeric', day: 'numeric'
});
const pad = (value: number) => String(value).padStart(2, '0');

function tehranMidnightUtc(isoDate: string): string {
  const wanted = Date.parse(`${isoDate}T00:00:00Z`);
  let instant = wanted;
  // Resolve the IANA time zone at the selected date, independent of the
  // browser's own time zone and of historical offset changes.
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = Object.fromEntries(tehranClock.formatToParts(new Date(instant)).map(x => [x.type, x.value]));
    const representedLocal = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second));
    instant += wanted - representedLocal;
  }
  return new Date(instant).toISOString();
}

export function promoDateBounds(startsJalali: string, endsJalali: string) {
  const startsIso = jalaliToIsoDate(startsJalali);
  const endsIso = jalaliToIsoDate(endsJalali);
  if (!startsIso || !endsIso || endsIso < startsIso) throw new Error('بازهٔ تاریخ شمسی کد تخفیف معتبر نیست.');
  const nextDay = new Date(Date.parse(`${endsIso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return { startsAt: tehranMidnightUtc(startsIso), expiresAt: tehranMidnightUtc(nextDay) };
}

export function promoJalaliDate(instant: string, inclusiveEnd = false): string {
  const date = new Date(Date.parse(instant) - (inclusiveEnd ? 1 : 0));
  const parts = Object.fromEntries(tehranPersian.formatToParts(date).map(x => [x.type, Number(x.value)]));
  return `${parts.year}/${pad(parts.month)}/${pad(parts.day)}`;
}
