import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection, type JsonSQLite } from '@capacitor-community/sqlite';
import { ShopRepository, type SqlPort, type SqlValue } from '@majora/database';
import schema from '../../../packages/database/migrations/001_init.sql?raw';
import productDetailMigration from '../../../packages/database/migrations/002_product_detail.sql?raw';
import archiveMigration from '../../../packages/database/migrations/003_archive.sql?raw';

export const nativeDevice = Capacitor.isNativePlatform();
let pending: Promise<ShopRepository> | undefined;
let activeConnection: SQLiteDBConnection | undefined;
const activeDatabase = () => {
  const saved = localStorage.getItem('majora-active-database-v1') ?? 'majora_shop';
  return /^majora_(shop|restore_[a-f0-9]{32})$/.test(saved) ? saved : 'majora_shop';
};

class NativePort implements SqlPort {
  constructor(private readonly connection: SQLiteDBConnection) {}
  async execute(sql: string): Promise<void> { await this.connection.execute(sql, false); }
  async run(sql: string, values: SqlValue[] = []): Promise<{ changes: number }> {
    const result = await this.connection.run(sql, values, false);
    return { changes: result.changes?.changes ?? 0 };
  }
  async query<T>(sql: string, values: SqlValue[] = []): Promise<T[]> {
    const result = await this.connection.query(sql, values);
    return (result.values ?? []) as T[];
  }
  async transaction<T>(work: () => Promise<T>): Promise<T> {
    await this.connection.beginTransaction();
    try { const result = await work(); await this.connection.commitTransaction(); return result; }
    catch (error) { await this.connection.rollbackTransaction(); throw error; }
  }
}

export function openNativeShop(): Promise<ShopRepository> {
  if (!nativeDevice) throw new Error('SQLite بومی فقط در برنامهٔ نصب‌شده فعال است.');
  pending ??= (async () => {
    const connection = await new SQLiteConnection(CapacitorSQLite).createConnection(activeDatabase(), false, 'no-encryption', 1, false);
    await connection.open();
    activeConnection = connection;
    const port = new NativePort(connection);
    await port.execute(schema);
    const applied = await port.query<{ version: number }>('SELECT version FROM schema_migrations WHERE version=2');
    if (!applied.length) await port.transaction(async () => { await port.execute(productDetailMigration); });
    const archiveApplied = await port.query<{ version: number }>('SELECT version FROM schema_migrations WHERE version=3');
    if (!archiveApplied.length) await port.transaction(async () => { await port.execute(archiveMigration); });
    const repo = new ShopRepository(port);
    await repo.initialize('کیف و کمربند کلاسیک');
    return repo;
  })();
  return pending;
}

export async function exportNativeDatabase(): Promise<JsonSQLite> {
  if (!activeConnection) throw new Error('پایگاه داده هنوز آماده نیست.');
  const exported = await activeConnection.exportToJson('full');
  if (!exported.export?.tables?.length) throw new Error('خروجی کامل SQLite خالی است.');
  return exported.export;
}

export async function importVerifiedDatabaseStage(snapshot: JsonSQLite): Promise<string> {
  if (!nativeDevice || !snapshot.tables?.length || snapshot.mode !== 'full') throw new Error('ساختار پشتیبان SQLite معتبر نیست.');
  const name = `majora_restore_${crypto.randomUUID().replaceAll('-', '')}`;
  const connection = new SQLiteConnection(CapacitorSQLite);
  const serialized = JSON.stringify({ ...snapshot, database: name, overwrite: true, encrypted: false });
  const valid = await connection.isJsonValid(serialized);
  if (!valid.result) throw new Error('ساختار JSON پایگاه داده معتبر نیست.');
  await connection.importFromJson(serialized);
  const stage = await connection.createConnection(name, false, 'no-encryption', 1, false);
  await stage.open();
  try {
    const integrity = await stage.query('PRAGMA integrity_check');
    if (Object.values(integrity.values?.[0] ?? {})[0] !== 'ok') throw new Error('بررسی یکپارچگی SQLite ناموفق بود.');
    const store = await stage.query("SELECT id FROM store WHERE id='classic-bag-belt' LIMIT 1");
    if (!store.values?.length) throw new Error('شناسهٔ فروشگاه در پشتیبان موجود نیست.');
  } finally { await connection.closeConnection(name, false); }
  return name;
}

export function activateRestoredDatabase(name: string): void {
  if (!/^majora_restore_[a-f0-9]{32}$/.test(name)) throw new Error('نام پایگاه دادهٔ بازیابی نامعتبر است.');
  localStorage.setItem('majora-active-database-v1', name);
}
