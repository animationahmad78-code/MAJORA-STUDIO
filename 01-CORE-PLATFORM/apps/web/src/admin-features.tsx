import { useEffect, useState } from 'react';
import { api, type Tenant } from './api';

type Feature = { key: string; name: string; requires: string[] };

export function AdminFeatures() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [catalog, setCatalog] = useState<Feature[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [disabled, setDisabled] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingPolicy, setLoadingPolicy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    Promise.all([api<Tenant[]>('/admin/tenants'), api<Feature[]>('/admin/feature-catalog')])
      .then(([shops, features]) => { setTenants(shops); setCatalog(features); if (shops.length) setTenantId(shops[0].id); })
      .catch(e => setError(e.message));
  }, [retry]);
  useEffect(() => {
    if (!tenantId) return;
    let active = true;
    setError('');
    setNotice('');
    setDisabled([]);
    setLoadingPolicy(true);
    api<{ disabled: string[] }>(`/admin/tenants/${tenantId}/features`)
      .then(x => { if (active) setDisabled(x.disabled); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'دسترسی بخش‌ها دریافت نشد.'); })
      .finally(() => { if (active) setLoadingPolicy(false); });
    return () => { active = false; };
  }, [tenantId, retry]);
  const blocked = catalog.flatMap(feature => feature.requires
    .filter(key => disabled.includes(key) && !disabled.includes(feature.key))
    .map(key => `«${feature.name}» به «${catalog.find(x => x.key === key)?.name ?? key}» نیاز دارد.`));
  const save = async () => {
    if (!tenantId || loadingPolicy || error || blocked.length) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await api<{ disabled: string[] }>(`/admin/tenants/${tenantId}/features`, 'PUT', { disabled });
      setDisabled(saved.disabled); setNotice('دسترسی بخش‌های این فروشگاه ذخیره شد.');
    } catch (e) { setError(e instanceof Error ? e.message : 'ذخیره انجام نشد.'); }
    finally { setBusy(false); }
  };
  return <div className="feature-settings">
    <div className="page-intro"><h2>قابلیت‌های هر فروشگاه</h2><p>بخش‌های فعال را برای فروشگاه انتخاب کنید. محدودیت در سرور هم اعمال می‌شود.</p></div>
    <section className="card">{tenants.length === 0 && !error ? <p className="empty">هنوز فروشگاهی ثبت نشده است. ابتدا از بخش «فروشگاه‌ها» یک فروشگاه بسازید.</p> : <label>فروشگاه<select value={tenantId} onChange={e => setTenantId(e.target.value)}>{tenants.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
      {error && <div className="field-error" role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>دریافت دوباره</button></div>}{notice && <p role="status">{notice}</p>}
      {tenantId && <>{loadingPolicy && <p role="status">در حال دریافت دسترسی‌های این فروشگاه…</p>}<div className="feature-grid">{catalog.map(feature => <label className="feature-choice" key={feature.key}>
        <input type="checkbox" disabled={loadingPolicy || !!error || busy} checked={!disabled.includes(feature.key)} onChange={e => setDisabled(current => e.target.checked ? current.filter(x => x !== feature.key) : [...current, feature.key])}/>
        <span><strong>{feature.name}</strong><small>{feature.requires.length ? `نیازمند: ${feature.requires.map(key => catalog.find(x => x.key === key)?.name ?? key).join('، ')}` : 'مستقل'}</small></span>
      </label>)}</div>{blocked.length > 0 && <div role="alert" className="field-error">{blocked.map(x => <p key={x}>{x} بخش وابسته را هم خاموش کنید یا این بخش را روشن نگه دارید.</p>)}</div>}
      <button className="primary" disabled={busy || loadingPolicy || !!error || blocked.length > 0} onClick={() => void save()}>{busy ? 'در حال ذخیره…' : 'ذخیرهٔ دسترسی‌ها'}</button></>}
    </section>
  </div>;
}
