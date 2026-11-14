import { useEffect, useState } from 'react';
import { api, dateFa } from './api';

type Session = { id: string; userId: string; username: string; displayName: string; role: string; createdAt: string; lastSeenAt: string; expiresAt: string; userAgent: string; ipAddress: string; current: boolean };

export function Sessions() {
  const [items, setItems] = useState<Session[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = async () => setItems(await api<Session[]>('/merchant/sessions'));
  useEffect(() => { void load().catch(e => setError(e instanceof Error ? e.message : 'نشست‌ها دریافت نشدند.')); }, []);
  const revoke = async (session: Session) => {
    if (!window.confirm(`دسترسی ${session.displayName} در این دستگاه قطع شود؟`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api(`/merchant/sessions/${session.id}/revoke`, 'POST');
      if (session.current) window.dispatchEvent(new Event('majora:session-changed'));
      else { await load(); setNotice('دسترسی دستگاه قطع شد.'); }
    } catch (e) { setError(e instanceof Error ? e.message : 'قطع دسترسی انجام نشد.'); }
    finally { setBusy(false); }
  };
  const logoutAll = async () => {
    if (!window.confirm('از همهٔ دستگاه‌های حساب خود خارج شوید؟ برای ورود دوباره به رمز عبور نیاز دارید.')) return;
    setBusy(true); setError('');
    try { await api('/auth/logout-all', 'POST'); }
    catch (e) { setError(e instanceof Error ? e.message : 'خروج از همهٔ دستگاه‌ها انجام نشد.'); setBusy(false); }
  };
  return <section className="card"><div className="card-head"><h2>دستگاه‌ها و نشست‌های فعال</h2><button type="button" disabled={busy} onClick={() => void load().catch(e => setError(e.message))}>تازه‌سازی</button></div>
    <p>هر نفر با حساب خودش وارد شود. مالک و مدیر می‌توانند دسترسی دستگاه‌های همکاران را قطع کنند.</p>
    {error && <p className="field-error" role="alert">{error}</p>}{notice && <p className="field-success" role="status">{notice}</p>}
    <button type="button" disabled={busy} onClick={() => void logoutAll()}>خروج حساب من از همهٔ دستگاه‌ها</button>
    <div className="list">{items.map(session => <div className="list-row" key={session.id}><div><strong>{session.displayName} {session.current && <span className="badge green">این دستگاه</span>}</strong><small>{session.username} · آخرین فعالیت {dateFa(session.lastSeenAt)}</small><small>شروع {dateFa(session.createdAt)} · پایان {dateFa(session.expiresAt)}</small><small dir="ltr">{session.userAgent || 'مرورگر ناشناس'} · {session.ipAddress}</small></div><button type="button" disabled={busy} onClick={() => void revoke(session)}>قطع دسترسی</button></div>)}{!items.length && <p className="empty">نشست فعالی پیدا نشد.</p>}</div>
  </section>;
}

export function AdminSessions({ users }: { users: { tenantId?: string; tenantName?: string }[] }) {
  const tenants = [...new Map(users.filter(x => x.tenantId).map(x => [x.tenantId!, x.tenantName || x.tenantId!])).entries()];
  const [tenantId, setTenantId] = useState('');
  const [items, setItems] = useState<Session[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = async (id: string) => setItems(await api<Session[]>(`/admin/tenants/${id}/sessions`));
  useEffect(() => { if (!tenantId) { setItems([]); return; } void load(tenantId).catch(e => setError(e instanceof Error ? e.message : 'نشست‌ها دریافت نشدند.')); }, [tenantId]);
  const revoke = async (session: Session) => {
    if (!window.confirm(`دسترسی دستگاه ${session.displayName} قطع شود؟`)) return;
    setBusy(true); setError('');
    try { await api(`/admin/tenants/${tenantId}/sessions/${session.id}/revoke`, 'POST'); await load(tenantId); }
    catch (e) { setError(e instanceof Error ? e.message : 'قطع دسترسی انجام نشد.'); }
    finally { setBusy(false); }
  };
  return <section className="card"><div className="card-head"><h2>نشست‌ها و دستگاه‌های فروشگاه‌ها</h2>{tenantId && <button type="button" onClick={() => void load(tenantId).catch(e => setError(e.message))}>تازه‌سازی</button>}</div>
    <label>فروشگاه<select value={tenantId} onChange={e => { setTenantId(e.target.value); setError(''); }}><option value="">یک فروشگاه انتخاب کنید</option>{tenants.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
    {error && <p className="field-error" role="alert">{error}</p>}
    {tenantId && <div className="list">{items.map(session => <div className="list-row" key={session.id}><div><strong>{session.displayName}</strong><small>{session.username} · آخرین فعالیت {dateFa(session.lastSeenAt)}</small><small dir="ltr">{session.userAgent || 'مرورگر ناشناس'} · {session.ipAddress}</small></div><button type="button" disabled={busy} onClick={() => void revoke(session)}>قطع دسترسی</button></div>)}{!items.length && <p className="empty">نشست فعالی پیدا نشد.</p>}</div>}
  </section>;
}
