export type User = { id: string; displayName: string; role: string; tenantId?: string; accessActive?: boolean };
export type Product = { id: string; name: string; sku: string; category: string; priceRial: number; averageCostRial: number | null; costKnown: boolean | null; stock: number; hasPhoto: boolean; updatedAt: string };
export type Customer = { id: string; name: string; phone: string };
export type CustomerWithStatus = Customer & { status: string; receivableRial: number };
export type Invoice = { id: string; number: number; revision: number; customerName: string; customerPhone: string; issuedAt: string; totalRial: number; paidRial: number; returnedRial: number; refundedRial: number; paymentStatus: string; status: string };
export type InvoiceDetail = Invoice & { lines: { id: string; productId?: string; nameSnapshot: string; unitPriceRial: number; quantity: number; returnedQuantity: number; totalRial: number }[] };
export type SalesReturn = { id: string; invoiceId: string; invoiceNumber: number; customerName: string; reason: string; amountRial: number; createdAt: string };
export const receivable = (invoice: Invoice) => invoice.paymentStatus === 'proforma' ? 0 : Math.max(0, invoice.totalRial - invoice.returnedRial - invoice.paidRial + invoice.refundedRial);
export const refundDue = (invoice: Invoice) => invoice.paymentStatus === 'proforma' ? 0 : Math.max(0, invoice.paidRial - invoice.refundedRial - invoice.totalRial + invoice.returnedRial);
export type Plan = { id: string; name: string; description: string; featuresJson: string; monthlyRial: number; maxUsers: number; maxDevices: number; enabled: boolean };
export type Tenant = { id: string; name: string; slug: string; enabled: boolean; brandColor: string; logoUrl?: string; subscription?: { id: string; endsAt: string; paymentStatus: string; priceRialSnapshot: number } };
export type InvoiceSocialLink = { platform: 'telegram' | 'instagram' | 'whatsapp' | 'bale' | 'rubika' | 'eitaa' | 'linkedin' | 'x' | 'website' | 'phone'; text: string; enabled: boolean };
export type InvoiceBrand = { revision: number; storeName: string; slogan: string; phone: string; address: string; card: string; cardHolder: string; note: string; conditions: string[]; socialTelegram: string; socialInstagram: string; socialContact: string; socialLinks: InvoiceSocialLink[]; logoDataUrl: string | null };
type Panel = 'admin' | 'merchant';
function activePanel(): Panel { return sessionStorage.getItem('majora.panel') === 'admin' ? 'admin' : 'merchant'; }
function panelFor(path: string): Panel { return path.startsWith('/admin') ? 'admin' : path.startsWith('/merchant') ? 'merchant' : activePanel(); }
function csrf(panel: Panel) { const name = panel === 'admin' ? 'majora.admin.csrf=' : 'majora.csrf='; return document.cookie.split('; ').find(x => x.startsWith(name))?.slice(name.length) ?? ''; }
export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly errorCode?: string, public readonly correlationId?: string) { super(message); }
}
async function request(response: () => Promise<Response>): Promise<Response> {
  try { return await response(); }
  catch (error) {
    if (error instanceof TypeError) throw new ApiError('ارتباط با سرور برقرار نشد. اتصال را بررسی کنید و دوباره تلاش کنید؛ اطلاعات فرم شما حفظ شده است.', 0, 'NETWORK_UNAVAILABLE');
    throw error;
  }
}
function sessionChanged(panel: Panel) { localStorage.setItem('majora.session.changed', `${panel}:${Date.now()}:${crypto.randomUUID()}`); }
export async function api<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const panel = panelFor(path);
  const url = path === '/auth/me' ? `/api/auth/me?panel=${panel}` : `/api${path}`;
  const body = data === undefined ? undefined : JSON.stringify(data);
  const send = () => fetch(url, { method, credentials: 'same-origin', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-CSRF': csrf(panel), 'X-Majora-Panel': panel } : {}) }, body });
  let response = await request(send);
  // A rejected CSRF request has not reached the mutation endpoint. Refresh the
  // readable token and retry that one request without discarding the form.
  if (response.status === 400 && method !== 'GET') {
    const failure = await response.clone().json().catch(() => ({})) as { error?: string };
    if (failure.error === 'توکن امنیتی درخواست نامعتبر است.') {
      const me = await request(() => fetch(`/api/auth/me?panel=${panel}`, { credentials: 'same-origin' }));
      if (me.ok) response = await request(send);
    }
  }
  if (!response.ok) {
    const json = await response.json().catch(() => ({})) as { error?: string; message?: string; errorCode?: string; correlationId?: string };
    if (response.status === 401 && path !== '/auth/me') window.dispatchEvent(new Event('majora:session-changed'));
    throw new ApiError(json.error ?? json.message ?? (response.status === 403 ? 'برای این عملیات دسترسی ندارید.' : `خطای ${response.status}`), response.status, json.errorCode, json.correlationId ?? response.headers.get('X-Correlation-ID') ?? undefined);
  }
  if (path === '/auth/logout' || path === '/auth/logout-all') {
    sessionChanged(panel);
    if (path === '/auth/logout-all') window.dispatchEvent(new Event('majora:session-changed'));
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export async function login(username: string, password: string) {
  const response = await request(() => fetch('/api/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) }));
  if (!response.ok) { const json = await response.json().catch(() => ({})); throw new ApiError(json.error ?? 'ورود ناموفق بود.', response.status); }
  const user = await response.json() as User;
  const panel: Panel = user.role === 'platform_admin' ? 'admin' : 'merchant';
  sessionStorage.setItem('majora.panel', panel);
  sessionChanged(panel);
  return user;
}
export const rial = (amount: number) => new Intl.NumberFormat('fa-IR').format(amount) + ' ریال';
export const dateFa = (date: string) => new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(date));
