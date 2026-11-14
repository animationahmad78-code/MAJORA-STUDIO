const MAX_EXACT_RIAL = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_SERVER_RIAL = 9223372036854775807n;

export type RevisionAmountLine = { price: string; quantity: string; discount: string };

export function invoiceRevisionMoney(lines: RevisionAmountLine[], minimumTotalRial: bigint) {
  let totalRial = 0n;
  let error: string | null = null;
  const lineTotals = lines.map((line, index): bigint | null => {
    const row = index + 1;
    if (line.price === '' || !/^\d+$/.test(line.price)) {
      error ??= `قیمت ردیف ${row} را با رقم معتبر وارد کنید.`;
      return null;
    }
    if (!/^\d+$/.test(line.quantity) || BigInt(line.quantity) < 1n || BigInt(line.quantity) > 1_000_000n) {
      error ??= `تعداد ردیف ${row} باید بین ۱ و یک‌میلیون باشد.`;
      return null;
    }
    if (line.discount !== '' && !/^\d+$/.test(line.discount)) {
      error ??= `تخفیف ردیف ${row} را با رقم معتبر وارد کنید.`;
      return null;
    }
    const price = BigInt(line.price);
    const quantity = BigInt(line.quantity);
    const discount = BigInt(line.discount || '0');
    if (price > MAX_EXACT_RIAL || discount > MAX_EXACT_RIAL) {
      error ??= `قیمت یا تخفیف ردیف ${row} از محدودهٔ ارسال دقیق این نسخه بیشتر است.`;
      return null;
    }
    const gross = price * quantity;
    if (gross > MAX_SERVER_RIAL) {
      error ??= `مبلغ ناخالص ردیف ${row} از محدودهٔ مجاز سرور بیشتر است.`;
      return null;
    }
    if (discount > gross) {
      error ??= `تخفیف ردیف ${row} از مبلغ همان ردیف بیشتر است.`;
      return null;
    }
    const net = gross - discount;
    totalRial += net;
    if (totalRial > MAX_EXACT_RIAL) error ??= 'جمع اصلاح‌شده از محدودهٔ نمایش دقیق این نسخه بیشتر است.';
    return net;
  });
  if (!error && totalRial < minimumTotalRial)
    error = 'جمع اصلاح‌شده از وجه دریافتی پس از بازپرداخت کمتر است.';
  return { lineTotals, totalRial, error };
}
