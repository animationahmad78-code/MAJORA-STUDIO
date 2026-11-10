import { useEffect, useState } from 'react';
import { api, type Tenant } from './api';

type Feature = { key: string; name: string; requires: string[] };

export function AdminFeatures() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [catalog, setCatalog] = useState<Feature[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [disabled, setDisabled] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    Promise.all([api<Tenant[]>('/admin/tenants'), api<Feature[]>('/admin/feature-catalog')])
      .then(([shops, features]) => { setTenants(shops); setCatalog(features); if (shops.length) setTenantId(shops[0].id); })
      .catch(e => setError(e.message));
  }, []);
  useEffect(() => {
    if (!tenantId) return;
    setError('');
    api<{ disabled: string[] }>(`/admin/tenants/${tenantId}/features`)
      .then(x => setDisabled(x.disabled))
      .catch(e => setError(e.message));
  }, [tenantId]);
  const blocked = catalog.flatMap(feature => feature.requires
    .filter(key => disabled.includes(key) && !disabled.includes(feature.key))
    .map(key => `«${feature.name}» به «${catalog.find(x => x.key === key)?.name ?? key}» نیاز دارد.`));
  const save = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await api<{ disabled: string[] }>(`/admin/tenants/${tenantId}/features`, 'PUT', { disabled });
      setDisabled(saved.disabled); setNotice('دسترسی بخش‌های این فروشگاه ذخیره شد.');
    } catch (e) { setError(e instanceof Error ? e.message : 'ذخیره انجام نشد.'); }
    finally { setBusy(false); }
  };
  return <div className="feature-settings">
    <div className="page-intro"><h2>قابلیت‌های هر فروشگاه</h2><p>بخش‌های فعال را برای فروشگاه انتخاب کنید. محدودیت در سرور هم اعمال می‌شود.</p></div>
    <section className="card"><label>فروشگاه<select value={tenantId} onChange={e => setTenantId(e.target.value)}>{tenants.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      {error && <p className="field-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
      {tenantId && <><div className="feature-grid">{catalog.map(feature => <label className="feature-choice" key={feature.key}>
        <input type="checkbox" checked={!disabled.includes(feature.key)} onChange={e => setDisabled(current => e.target.checked ? current.filter(x => x !== feature.key) : [...current, feature.key])}/>
        <span><strong>{feature.name}</strong><small>{feature.requires.length ? `نیازمند: ${feature.requires.map(key => catalog.find(x => x.key === key)?.name ?? key).join('، ')}` : 'مستقل'}</small></span>
      </label>)}</div>{blocked.length > 0 && <div role="alert" className="field-error">{blocked.map(x => <p key={x}>{x} بخش وابسته را هم خاموش کنید یا این بخش را روشن نگه دارید.</p>)}</div>}
      <button className="primary" disabled={busy || blocked.length > 0} onClick={() => void save()}>{busy ? 'در حال ذخیره…' : 'ذخیرهٔ دسترسی‌ها'}</button></>}
    </section>
  </div>;
}
