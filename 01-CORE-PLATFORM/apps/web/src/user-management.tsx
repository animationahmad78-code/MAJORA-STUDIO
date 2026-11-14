import { useEffect, useState } from 'react';
import { api, dateFa } from './api';
import { AdminSessions, Sessions } from './sessions';

type ManagedUser = { id: string; username: string; displayName: string; role: string; enabled: boolean; tenantId?: string; tenantName?: string };
type Activity = { id: string; at: string; actorName: string; action: string; entityType: string; entityId: string; detail: string; tenantId?: string };

const actionLabels: Record<string, string> = {
  'tenant.create': 'فروشگاه ایجاد کرد', 'tenant.update': 'مشخصات فروشگاه را تغییر داد',
  'invoice.issue': 'فاکتور ثبت کرد', 'invoice.revise': 'فاکتور را ویرایش کرد',
  'invoice.convert-proforma': 'پیش‌فاکتور را به فروش تبدیل کرد',
  'product.create': 'کالا افزود', 'product.update': 'کالا را ویرایش کرد',
  'customer.create': 'مشتری افزود', 'customer.update': 'مشتری را ویرایش کرد',
  'purchase.receive': 'خرید ثبت کرد', 'purchase.payment': 'پرداخت خرید ثبت کرد',
  'expense.create': 'هزینه ثبت کرد', 'expense.void': 'هزینه را باطل کرد',
  'cheque.create': 'چک ثبت کرد', 'cheque.update': 'اطلاعات چک را تغییر داد', 'cheque.status': 'وضعیت چک را تغییر داد',
  'reminder.create': 'یادآور افزود', 'reminder.done': 'یادآور را انجام‌شده کرد',
  'payment.record': 'دریافت وجه ثبت کرد', 'refund.record': 'بازپرداخت ثبت کرد',
  'sales-return.record': 'مرجوعی ثبت کرد', 'archive.add': 'موردی را بایگانی کرد', 'archive.restore': 'موردی را از بایگانی برگرداند', 'archive.purge': 'مورد بدون سابقه را حذف کرد',
  'session.revoke': 'دسترسی دستگاهی را قطع کرد', 'session.revoke-all': 'از همهٔ دستگاه‌های خود خارج شد',
  'auth.login.success': 'وارد حساب شد', 'auth.login.failed': 'ورود ناموفق داشت', 'auth.logout': 'از حساب خارج شد',
  'staff.create': 'حساب همکار ساخت', 'staff.enabled': 'وضعیت همکار را تغییر داد',
  'password.admin-reset': 'رمز کاربر را بازنشانی کرد', 'password.owner-reset': 'رمز همکار را بازنشانی کرد',
  'invoice-brand.admin-update': 'هویت فاکتور را تغییر داد', 'invoice-brand.merchant-update': 'مشخصات فاکتور را تغییر داد',
  'subscription.create': 'اشتراک ثبت کرد', 'subscription-order.submit': 'درخواست اشتراک ثبت کرد'
};
const entityLabels: Record<string, string> = { invoice: 'فاکتور', product: 'کالا', customer: 'مشتری', purchase: 'خرید', expense: 'هزینه', cheque: 'چک', reminder: 'یادآور', tenant: 'فروشگاه', user: 'کاربر', session: 'نشست', 'invoice-brand': 'قالب فاکتور' };
const roleLabels: Record<string, string> = { platform_admin: 'مالک ماژورا', owner: 'مالک فروشگاه', manager: 'مدیر', cashier: 'صندوق‌دار', warehouse: 'انباردار', accountant: 'حسابدار', viewer: 'مشاهده‌گر', staff: 'همکار' };
const detailLabels: Record<string, string> = { number: 'شماره فاکتور', amount: 'مبلغ', old: 'مقدار قبلی', new: 'مقدار جدید', from: 'نسخه قبلی', to: 'نسخه جدید', reason: 'دلیل', ip: 'نشانی شبکه', count: 'تعداد', percent: 'درصد', enabled: 'فعال', model: 'مدل', subscription: 'اشتراک', return: 'مرجوعی', status: 'وضعیت' };
const authReasons: Record<string, string> = { accepted: 'ورود موفق', requested: 'خروج به درخواست کاربر', invalid_credentials: 'نام کاربری یا رمز نادرست', missing_credentials: 'اطلاعات ورود ناقص', disabled_account: 'حساب غیرفعال', subscription_inactive: 'اشتراک غیرفعال', session_limit: 'سقف نشست‌ها تکمیل' };
function readableDetail(detail: string) {
  return detail.split(';').map(part => {
    const separator = part.indexOf('=');
    if (separator < 0) return part.trim();
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    return `${detailLabels[key] ?? key}: ${authReasons[value] ?? (value === 'True' ? 'بله' : value === 'False' ? 'خیر' : value)}`;
  }).filter(Boolean).join(' · ');
}

export function UserManagement({ admin }: { admin: boolean }) {
  const root = admin ? '/admin' : '/merchant';
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [query, setQuery] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [passwordId, setPasswordId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [activityPage, setActivityPage] = useState(1);
  const [activityQuery, setActivityQuery] = useState('');
  const [activitySearch, setActivitySearch] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = async () => {
    const [people, events] = await Promise.all([
      api<ManagedUser[]>(admin ? '/admin/users' : '/merchant/staff'),
      api<Activity[]>(`${root}/activity?page=${activityPage}&q=${encodeURIComponent(activitySearch)}`)
    ]);
    setUsers(people); setActivity(events);
  };
  useEffect(() => { const timer = window.setTimeout(() => { setActivityPage(1); setActivitySearch(activityQuery.trim()); }, 250); return () => window.clearTimeout(timer); }, [activityQuery]);
  useEffect(() => { void load().catch(e => setError(e instanceof Error ? e.message : 'فهرست کاربران بارگذاری نشد.')); }, [admin, activityPage, activitySearch]);
  const rename = async (id: string) => {
    if (busy || !username.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api(`${admin ? '/admin/users' : '/merchant/staff'}/${id}/username`, 'PUT', { username: username.trim() });
      setEditId(null); await load(); setNotice('نام کاربری تغییر کرد. نشست‌های قبلی این کاربر باطل شدند.');
    } catch (e) { setError(e instanceof Error ? e.message : 'تغییر نام کاربری انجام نشد.'); }
    finally { setBusy(false); }
  };
  const reset = async (person: ManagedUser) => {
    if (busy) return;
    if (newPassword.length < 12) { setError('رمز جدید باید دست‌کم ۱۲ نویسه باشد.'); return; }
    if (newPassword !== confirmPassword) { setError('تکرار رمز با رمز جدید یکسان نیست.'); return; }
    if (!window.confirm(`رمز ${person.displayName} تغییر کند و نشست‌های قبلی او باطل شوند؟`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api(`${admin ? '/admin/users' : '/merchant/staff'}/${person.id}/reset-password`, 'POST', { newPassword });
      setPasswordId(null); setNewPassword(''); setConfirmPassword('');
      await load(); setNotice('رمز جدید ثبت شد و نشست‌های قبلی این کاربر باطل شدند.');
    } catch (e) { setError(e instanceof Error ? e.message : 'بازنشانی رمز انجام نشد.'); }
    finally { setBusy(false); }
  };
  const filtered = users.filter(user => `${user.username} ${user.displayName} ${user.tenantName ?? ''}`.toLocaleLowerCase('fa-IR').includes(query.toLocaleLowerCase('fa-IR')));
  return <div className="user-management">
    <section className="card"><div className="card-head"><h2>{admin ? 'همهٔ حساب‌ها' : 'مدیریت حساب همکاران'}</h2></div>
      <p>نام کاربری و رمز جدید را خودتان تعیین می‌کنید. رمز فعلی برای امنیت قابل مشاهده نیست؛ رمز تازه را هنگام تعیین نزد خود نگه دارید.</p>
      {error && <div className="field-error" role="alert">{error}</div>}{notice && <div className="field-success" role="status">{notice}</div>}
      <label>جست‌وجوی نام، نام کاربری یا فروشگاه<input type="search" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <div className="list">{filtered.map(person => <div className="list-row managed-user" key={person.id}>
        <div><strong>{person.displayName}</strong><small dir="ltr">{person.username}</small>{person.tenantName && <small>{person.tenantName}</small>}</div>
        <span className={'badge ' + (person.enabled ? 'green' : 'amber')}>{person.enabled ? 'فعال' : 'غیرفعال'} · {roleLabels[person.role] ?? person.role}</span>
        {(admin ? person.role !== 'platform_admin' : person.role !== 'owner') && <div className="user-actions">
          {editId === person.id ? <form onSubmit={e => { e.preventDefault(); void rename(person.id); }}><label>نام کاربری جدید<input value={username} onChange={e => setUsername(e.target.value)} maxLength={100} required autoComplete="off" /></label><button className="primary" disabled={busy}>ذخیره</button><button type="button" onClick={() => setEditId(null)}>انصراف</button></form> : <button type="button" onClick={() => { setEditId(person.id); setUsername(person.username); }}>تغییر نام کاربری</button>}
          {passwordId === person.id ? <form onSubmit={e => { e.preventDefault(); void reset(person); }}><label>رمز جدید دلخواه<input type={showPassword ? 'text' : 'password'} value={newPassword} onChange={e => setNewPassword(e.target.value)} minLength={12} autoComplete="new-password" required /></label><label>تکرار رمز جدید<input type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} minLength={12} autoComplete="new-password" required /></label><label><input type="checkbox" checked={showPassword} onChange={e => setShowPassword(e.target.checked)} />نمایش رمز در حال تعیین</label><button className="primary" disabled={busy}>ثبت رمز</button><button type="button" onClick={() => { setPasswordId(null); setNewPassword(''); setConfirmPassword(''); }}>انصراف</button></form> : <button type="button" disabled={busy} onClick={() => { setPasswordId(person.id); setNewPassword(''); setConfirmPassword(''); setError(''); }}>تعیین رمز جدید</button>}
        </div>}
      </div>)}{!filtered.length && <p className="empty">کاربری مطابق جست‌وجو پیدا نشد.</p>}</div>
    </section>
    <section className="card"><div className="card-head"><h2>تاریخچهٔ فعالیت‌ها</h2><button type="button" onClick={() => void load().catch(e => setError(e.message))}>تازه‌سازی</button></div>
      <p>رویدادها به ترتیب زمان و در صفحه‌های ۱۰۰ تایی نمایش داده می‌شوند. جزئیات هر مورد را در صورت نیاز باز کنید.</p>
      <label>جست‌وجو در کل تاریخچه<input type="search" value={activityQuery} onChange={e => setActivityQuery(e.target.value)} placeholder="نام کاربر یا شناسهٔ مورد" maxLength={100} /></label>
      <div className="list">{activity.map(event => <details className="list-row activity-item" key={event.id}><summary><strong>{event.actorName} · {actionLabels[event.action] ?? 'فعالیتی ثبت کرد'}</strong><small>{dateFa(event.at)} · {entityLabels[event.entityType] ?? 'مورد مرتبط'}</small></summary><div><p>شناسه: <code dir="ltr">{event.entityId}</code></p>{event.detail && <p>جزئیات: {readableDetail(event.detail)}</p>}</div></details>)}{!activity.length && <p className="empty">رویدادی مطابق جست‌وجو پیدا نشد.</p>}</div>
      <div className="activity-pager"><button type="button" disabled={activityPage === 1} onClick={() => setActivityPage(n => n - 1)}>صفحهٔ قبل</button><span>صفحهٔ {activityPage.toLocaleString('fa-IR')}</span><button type="button" disabled={activity.length < 100} onClick={() => setActivityPage(n => n + 1)}>صفحهٔ بعد</button></div>
    </section>
    {admin ? <AdminSessions users={users} /> : <Sessions />}
  </div>;
}
