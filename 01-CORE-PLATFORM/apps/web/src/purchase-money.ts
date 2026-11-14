const MAX_EXACT_RIAL = BigInt(Number.MAX_SAFE_INTEGER);

export type PurchaseAmountRow = {
  productId: string;
  quantity: number;
  unitCostRial: string;
  priceRial: string;
};

export function purchaseMoney(rows: PurchaseAmountRow[], paid: string): { totalRial: bigint; error: string | null } {
  let totalRial = 0n;
  for (const [index, row] of rows.entries()) {
    if (!Number.isSafeInteger(row.quantity) || row.quantity < 1 || row.quantity > 1_000_000)
      return { totalRial, error: `تعداد ردیف ${index + 1} باید یک عدد صحیح بین ۱ و یک‌میلیون باشد.` };
    if (row.unitCostRial === '')
      return { totalRial, error: `فی خرید ردیف ${index + 1} را وارد کنید؛ برای کالای بدون هزینه، صفر را صریح ثبت کنید.` };
    if (row.unitCostRial !== '' && !/^\d+$/.test(row.unitCostRial))
      return { totalRial, error: `فی خرید ردیف ${index + 1} را با رقم معتبر وارد کنید.` };
    const unitCost = BigInt(row.unitCostRial || '0');
    if (unitCost > MAX_EXACT_RIAL)
      return { totalRial, error: `فی خرید ردیف ${index + 1} از محدودهٔ محاسبهٔ دقیق مرورگر بیشتر است.` };
    totalRial += BigInt(row.quantity) * unitCost;
    if (totalRial > MAX_EXACT_RIAL)
      return { totalRial, error: 'جمع خرید از محدودهٔ محاسبهٔ دقیق این نسخه بیشتر است؛ خرید را به سندهای کوچک‌تر تقسیم کنید.' };
    if (row.productId === 'new') {
      if (row.priceRial === '')
        return { totalRial, error: `قیمت فروش کالای تازه در ردیف ${index + 1} را وارد کنید.` };
      if (row.priceRial !== '' && !/^\d+$/.test(row.priceRial))
        return { totalRial, error: `قیمت فروش کالای تازه در ردیف ${index + 1} معتبر نیست.` };
      if (BigInt(row.priceRial || '0') > MAX_EXACT_RIAL)
        return { totalRial, error: `قیمت فروش کالای تازه در ردیف ${index + 1} از محدودهٔ محاسبهٔ دقیق مرورگر بیشتر است.` };
    }
  }
  if (paid !== '' && !/^\d+$/.test(paid)) return { totalRial, error: 'مبلغ پرداخت‌شده را با رقم معتبر وارد کنید.' };
  const paidRial = BigInt(paid || '0');
  if (paidRial > MAX_EXACT_RIAL || paidRial > totalRial)
    return { totalRial, error: 'مبلغ پرداخت‌شده باید دقیق و حداکثر برابر جمع خرید باشد.' };
  return { totalRial, error: null };
}

export function formatBigRial(value: bigint): string {
  return new Intl.NumberFormat('fa-IR').format(value) + ' ریال';
}
