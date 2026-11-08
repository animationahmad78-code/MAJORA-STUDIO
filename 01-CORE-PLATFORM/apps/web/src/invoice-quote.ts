export function percentThousandths(input: string): number | null {
  const normalized = input.replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 1776)).replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 1632)).replace('٫', '.').trim();
  if (!/^\d+(?:\.\d{1,3})?$/.test(normalized)) return null;
  const percent = Number(normalized);
  return percent >= 0 && percent <= 100 ? Math.round(percent * 1000) : null;
}

export function discountedLineRial(unitPrice: number, quantity: number, percentBasis: number): number {
  if (!Number.isSafeInteger(unitPrice) || unitPrice < 0 || !Number.isSafeInteger(quantity) || quantity < 1 ||
      !Number.isSafeInteger(percentBasis) || percentBasis < 0 || percentBasis > 100000) throw new Error('مبلغ یا درصد نامعتبر است.');
  const gross = BigInt(unitPrice) * BigInt(quantity);
  const net = gross - (gross * BigInt(percentBasis) + 50000n) / 100000n;
  if (net > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('مبلغ فاکتور از حد مجاز نمایش دقیق فراتر است.');
  return Number(net);
}
