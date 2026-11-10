import './payment-badge.css';

const payment: Record<string, { label: string; className: string }> = {
  returned_cheque: { label: 'چک برگشتی', className: 'red' },
  receivable: { label: 'دارای مانده', className: 'amber' },
  settled: { label: 'تسویه', className: 'green' },
  no_sales: { label: 'بدون فروش', className: 'neutral' },
  paid: { label: 'تسویه', className: 'green' },
  partial: { label: 'پیش‌پرداخت / مانده', className: 'amber' },
  unpaid: { label: 'تسویه نشده', className: 'red' },
  cheque: { label: 'چک در انتظار وصول', className: 'amber' },
  proforma: { label: 'پیش‌فاکتور', className: 'neutral' },
  refund_due: { label: 'بازپرداخت باز', className: 'amber' },
  returned: { label: 'مرجوع شده', className: 'neutral' }
};

export function PaymentBadge({ status }: { status: string }) {
  const display = payment[status] ?? { label: 'وضعیت نامشخص', className: 'neutral' };
  return <span className={`badge ${display.className}`} aria-label={`وضعیت پرداخت: ${display.label}`}>{display.label}</span>;
}
