export type User = { id: string; displayName: string; role: string; tenantId?: string };
export type Product = { id: string; name: string; sku: string; category: string; priceRial: number; averageCostRial: number; costKnown: boolean; stock: number; hasPhoto: boolean; updatedAt: string };
export type Customer = { id: string; name: string; phone: string };
export type Invoice = { id: string; number: number; customerName: string; customerPhone: string; issuedAt: string; totalRial: number; paidRial: number; returnedRial: number; refundedRial: number; paymentStatus: string; status: string };
export type InvoiceDetail = Invoice & { lines: { id: string; productId?: string; nameSnapshot: string; unitPriceRial: number; quantity: number; returnedQuantity: number; totalRial: number }[] };
export type SalesReturn = { id: string; invoiceId: string; invoiceNumber: number; customerName: string; reason: string; amountRial: number; createdAt: string };
export const receivable = (invoice: Invoice) => Math.max(0, invoice.totalRial - invoice.returnedRial - invoice.paidRial + invoice.refundedRial);
export const refundDue = (invoice: Invoice) => Math.max(0, invoice.paidRial - invoice.refundedRial - invoice.totalRial + invoice.returnedRial);
export type Plan = { id: string; name: string; monthlyRial: number; maxUsers: number; enabled: boolean };
export type Tenant = { id: string; name: string; slug: string; enabled: boolean; brandColor: string; logoUrl?: string; subscription?: { endsAt: string; paymentStatus: string; priceRialSnapshot: number } };
export type InvoiceBrand = { revision: number; storeName: string; slogan: string; phone: string; address: string; card: string; cardHolder: string; note: string; conditions: string[]; socialTelegram: string; socialInstagram: string; socialContact: string; logoDataUrl: string | null };
function csrf() { return document.cookie.split('; ').find(x => x.startsWith('majora.csrf='))?.split('=')[1] ?? ''; }
export async function api<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method, credentials: 'same-origin', headers: { ...(data ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-CSRF': csrf() } : {}) }, body: data ? JSON.stringify(data) : undefined });
  if (!response.ok) { const json = await response.json().catch(() => ({})); throw new Error(json.error ?? `خطای ${response.status}`); }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export async function login(username: string, password: string) {
  const response = await fetch('/api/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  if (!response.ok) { const json = await response.json().catch(() => ({})); throw new Error(json.error ?? 'ورود ناموفق بود.'); }
  return response.json() as Promise<User>;
}
export const rial = (amount: number) => new Intl.NumberFormat('fa-IR').format(amount) + ' ریال';
export const dateFa = (date: string) => new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(date));
