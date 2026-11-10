import { useEffect, useState } from 'react';
import { api, dateFa } from './api';

type ManagedUser = { id: string; username: string; displayName: string; role: string; enabled: boolean; tenantId?: string; tenantName?: string };
type Activity = { id: string; at: string; actorName: string; action: string; entityType: string; entityId: string; detail: string; tenantId?: string };

const randomPassword = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), byte => byte.toString(16).padStart(2, '0')).join('');

export function UserManagement({ admin }: { admin: boolean }) {
  const root = admin ? '/admin' : '/merchant';
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [query, setQuery] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [revealed, setRevealed] = useState<{ username: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = async () => {
    const [people, events] = await Promise.all([
      api<ManagedUser[]>(admin ? '/admin/users' : '/merchant/staff'),
      api<Activity[]>(`${root}/activity`)
    ]);
    setUsers(people); setActivity(events);
  };
  useEffect(() => { void load().catch(e => setError(e instanceof Error ? e.message : 'فهرست کاربران بارگذاری نشد.')); }, [admin]);
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
    if (busy || !window.confirm(`رمز ${person.displayName} بازنشانی و نشست‌های قبلی او باطل شوند؟`)) return;
    const password = randomPassword();
    setBusy(true); setError(''); setNotice(''); setRevealed(null);
    try {
      await api(`${admin ? '/admin/users' : '/merchant/staff'}/${person.id}/reset-password`, 'POST', { newPassword: password });
      setRevealed({ username: person.username, password });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'بازنشانی رمز انجام نشد.'); }
    finally { setBusy(false); }
  };
  const filtered = users.filter(user => `${user.username} ${user.displayName} ${user.tenantName ?? ''}`.toLocaleLowerCase('fa-IR').includes(query.toLocaleLowerCase('fa-IR')));
  return <div className="user-management">
    <section className="card"><div className="card-head"><h2>{admin ? 'همهٔ حساب‌ها' : 'مدیریت حساب همکاران'}</h2></div>
      <p>نام کاربری قابل تغییر است. رمز فعلی بازیابی یا نمایش داده نمی‌شود؛ رمز جدید فقط یک بار پس از بازنشانی نشان داده می‌شود.</p>
      {error && <div className="field-error" role="alert">{error}</div>}{notice && <div className="field-success" role="status">{notice}</div>}
      {revealed && <div className="one-time-password" role="status"><strong>رمز موقت {revealed.username}</strong><code dir="ltr">{revealed.password}</code><small>همین حالا آن را به روش امن تحویل دهید. بعد از بستن این کادر دیگر نمایش داده نمی‌شود.</small><button type="button" onClick={() => setRevealed(null)}>بستن</button></div>}
      <label>جست‌وجوی نام، نام کاربری یا فروشگاه<input type="search" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <div className="list">{filtered.map(person => <div className="list-row managed-user" key={person.id}>
        <div><strong>{person.displayName}</strong><small dir="ltr">{person.username}</small>{person.tenantName && <small>{person.tenantName}</small>}</div>
        <span className={'badge ' + (person.enabled ? 'green' : 'amber')}>{person.enabled ? 'فعال' : 'غیرفعال'} · {person.role}</span>
        {(admin ? person.role !== 'platform_admin' : person.role !== 'owner') && <div className="user-actions">
          {editId === person.id ? <form onSubmit={e => { e.preventDefault(); void rename(person.id); }}><label>نام کاربری جدید<input value={username} onChange={e => setUsername(e.target.value)} maxLength={100} required autoComplete="off" /></label><button className="primary" disabled={busy}>ذخیره</button><button type="button" onClick={() => setEditId(null)}>انصراف</button></form> : <button type="button" onClick={() => { setEditId(person.id); setUsername(person.username); }}>تغییر نام کاربری</button>}
          <button type="button" disabled={busy} onClick={() => void reset(person)}>بازنشانی رمز</button>
        </div>}
      </div>)}{!filtered.length && <p className="empty">کاربری مطابق جست‌وجو پیدا نشد.</p>}</div>
    </section>
    <section className="card"><div className="card-head"><h2>تاریخچهٔ فعالیت‌ها</h2><button type="button" onClick={() => void load().catch(e => setError(e.message))}>تازه‌سازی</button></div>
      <p>صد رویداد آخر همراه با نام کاربری عامل ثبت شده است.</p>
      <div className="list">{activity.map(event => <div className="list-row" key={event.id}><div><strong>{event.actorName} · {event.action}</strong><small>{dateFa(event.at)} · {event.entityType} · {event.entityId}</small></div></div>)}{!activity.length && <p className="empty">رویدادی ثبت نشده است.</p>}</div>
    </section>
  </div>;
}
