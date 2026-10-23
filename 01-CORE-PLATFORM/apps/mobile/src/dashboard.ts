import type { Product } from '@majora/domain';
import type { CustomerSummary, InvoiceHistoryEntry } from '@majora/database';

export type SalesPeriod = 'day' | 'week' | 'month';
export type Dashboard = {
  revenueRial: number; invoiceCount: number; itemsSold: number; newCustomers: number; averageInvoiceRial: number;
  trend: { label: string; revenueRial: number }[];
  topProducts: { key: string; name: string; units: number; revenueRial: number }[];
  inventory: { category: string; units: number; products: number; lowOrEmpty: number }[];
  lowStock: Product[];
};

function persianMonth(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-persian', { year: 'numeric', month: '2-digit' }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}`;
}

function sameLocalDate(a: Date, b: Date): boolean { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }

export function buildDashboard(invoices: InvoiceHistoryEntry[], products: Product[], customers: CustomerSummary[], period: SalesPeriod, now = new Date()): Dashboard {
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 1) % 7));
  const inPeriod = (at: string) => {
    const date = new Date(at);
    if (!Number.isFinite(date.getTime()) || date > now) return false;
    if (period === 'day') return sameLocalDate(date, now);
    if (period === 'week') return date >= weekStart;
    return persianMonth(date) === persianMonth(now);
  };
  const allIssued = Array.from(new Map(invoices.filter(entry => entry.status === 'issued').map(entry => [entry.receipt.id, entry])).values());
  const selected = allIssued.filter(entry => inPeriod(entry.receipt.at));
  const sum = (values: number[]) => {
    const total = values.reduce((current, value) => current + BigInt(value), 0n);
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('جمع فروش از محدودهٔ محاسبهٔ ایمن بیشتر است.');
    return Number(total);
  };
  const revenueRial = sum(selected.map(entry => entry.receipt.totalRial));
  const itemsSold = selected.flatMap(entry => entry.receipt.lines).reduce((count, line) => count + line.quantity, 0);
  const top = new Map<string, { key: string; name: string; units: number; revenueRial: number }>();
  for (const line of selected.flatMap(entry => entry.receipt.lines)) {
    const key = line.productId || line.name;
    const current = top.get(key) ?? { key, name: line.name, units: 0, revenueRial: 0 };
    current.units += line.quantity; current.revenueRial += line.totalRial;
    top.set(key, current);
  }
  const inventory = new Map<string, { category: string; units: number; products: number; lowOrEmpty: number }>();
  for (const product of products.filter(item => !item.archived)) {
    const category = product.category.split('/')[0] || 'بدون دسته';
    const current = inventory.get(category) ?? { category, units: 0, products: 0, lowOrEmpty: 0 };
    current.units += product.stock; current.products += 1; current.lowOrEmpty += product.stock <= 3 ? 1 : 0;
    inventory.set(category, current);
  }
  const trend = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (6 - index));
    return { label: new Intl.DateTimeFormat('fa-IR-u-ca-persian', { month: 'numeric', day: 'numeric' }).format(date),
      revenueRial: sum(allIssued.filter(entry => sameLocalDate(new Date(entry.receipt.at), date)).map(entry => entry.receipt.totalRial)) };
  });
  return {
    revenueRial, invoiceCount: selected.length, itemsSold,
    newCustomers: customers.filter(item => item.createdAt && inPeriod(item.createdAt)).length,
    averageInvoiceRial: selected.length ? Math.round(revenueRial / selected.length) : 0,
    trend, topProducts: [...top.values()].sort((a, b) => b.units - a.units || b.revenueRial - a.revenueRial).slice(0, 5),
    inventory: [...inventory.values()].sort((a, b) => b.units - a.units),
    lowStock: products.filter(item => !item.archived && item.stock <= 3).sort((a, b) => a.stock - b.stock).slice(0, 8)
  };
}
