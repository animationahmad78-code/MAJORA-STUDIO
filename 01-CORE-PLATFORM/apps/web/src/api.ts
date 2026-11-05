export type User = { id: string; displayName: string; role: string; tenantId?: string };
export type Product = { id: string; name: string; sku: string; category: string; priceRial: number; averageCostRial: number; costKnown: boolean; stock: number };
export type Customer = { id: string; name: string; phone: string };
export type Invoice = { id: string; number: number; customerName: string; issuedAt: string; totalRial: number; paidRial: number; paymentStatus: string; status: string };
export type Plan = { id: string; name: string; monthlyRial: number; maxUsers: number; enabled: boolean };
export type Tenant = { id: string; name: string; slug: string; enabled: boolean; brandColor: string; logoUrl?: string; subscription?: { endsAt: string; paymentStatus: string; priceRialSnapshot: number } };
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
