import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { ShopRepository, type SqlPort, type SqlValue } from '../packages/database/src/index';

function memoryShop() {
  const sqlite = new DatabaseSync(':memory:');
  const migration = readFileSync(new URL('../packages/database/migrations/001_init.sql', import.meta.url), 'utf8');
  sqlite.exec(migration);
  sqlite.exec(migration); // Starting the app again must not destroy or reject an existing database.
  const port: SqlPort = {
    async execute(sql) { sqlite.exec(sql); },
    async run(sql, values: SqlValue[] = []) {
      const result = sqlite.prepare(sql).run(...values);
      return { changes: Number(result.changes) };
    },
    async query<T>(sql: string, values: SqlValue[] = []) {
      return sqlite.prepare(sql).all(...values) as T[];
    },
    async transaction<T>(work: () => Promise<T>) {
      sqlite.exec('BEGIN IMMEDIATE');
      try { const result = await work(); sqlite.exec('COMMIT'); return result; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    }
  };
  return { sqlite, repo: new ShopRepository(port) };
}

describe('SQLite operational records', () => {
  it('persists products, the stock opening and exact bulk price history', async () => {
    const { sqlite, repo } = memoryShop();
    await repo.initialize('کیف و کمربند کلاسیک');
    await repo.addProduct({ id: 'bag', name: 'کیف چرمی', category: 'کیف', priceRial: 1001, stock: 3 });
    await repo.addProduct({ id: 'belt', name: 'کمربند', category: 'کمربند', priceRial: 500, stock: 2 });
    expect((await repo.listProducts('كيف چرمي')).map(p => p.id)).toEqual(['bag']);
    const { batch, events } = await repo.changePrices(['bag', 'belt'], 1000);
    expect(events.map(e => e.newPriceRial).sort((a, b) => a - b)).toEqual([550, 1101]);
    expect((await repo.listPriceHistory()).batches[0].id).toBe(batch.id);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM stock_movement').get()).toMatchObject({ n: 2 });
    const result = await repo.undoPrices(batch.id);
    expect(result).toEqual({ restored: 2, conflicts: [] });
    expect((await repo.listProducts()).map(p => p.priceRial).sort((a, b) => a - b)).toEqual([500, 1001]);
    await expect(repo.undoPrices(batch.id)).rejects.toThrow();
    sqlite.close();
  });

  it('rolls the entire operation back when any selected product is missing', async () => {
    const { sqlite, repo } = memoryShop();
    await repo.initialize('test');
    await repo.addProduct({ id: 'bag', name: 'کیف', category: 'کیف', priceRial: 1000, stock: 1 });
    await expect(repo.changePrices(['bag', 'missing'], 1000)).rejects.toThrow();
    expect((await repo.listProducts())[0].priceRial).toBe(1000);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM price_batch').get()).toMatchObject({ n: 0 });
    sqlite.close();
  });

  it('retains a later manual price while undoing untouched products', async () => {
    const { sqlite, repo } = memoryShop();
    await repo.initialize('test');
    await repo.addProduct({ id: 'bag', name: 'کیف', category: 'کیف', priceRial: 1000, stock: 1 });
    await repo.addProduct({ id: 'belt', name: 'کمربند', category: 'کمربند', priceRial: 2000, stock: 1 });
    const { batch } = await repo.changePrices(['bag', 'belt'], 1000);
    await repo.updatePrice('bag', 9999);
    expect(await repo.undoPrices(batch.id)).toEqual({ restored: 1, conflicts: ['bag'] });
    const products = await repo.listProducts();
    expect(products.find(p => p.id === 'bag')?.priceRial).toBe(9999);
    expect(products.find(p => p.id === 'belt')?.priceRial).toBe(2000);
    sqlite.close();
  });

  it('issues once, snapshots prices and subtracts stock in one transaction', async () => {
    const { sqlite, repo } = memoryShop();
    await repo.initialize('test');
    await repo.addProduct({ id: 'bag', name: 'کیف', category: 'کیف', priceRial: 1500, stock: 3 });
    const input = [{ productId: 'bag', quantity: 2 }, { name: 'هزینه بسته‌بندی', unitPriceRial: 100, quantity: 1 }];
    const issued = await repo.issueInvoice('request-1', 'مریم', input);
    expect(issued).toMatchObject({ number: 1, totalRial: 3100, customerName: 'مریم' });
    expect(await repo.issueInvoice('request-1', 'مریم', input)).toEqual(issued);
    expect((await repo.listProducts())[0].stock).toBe(1);
    expect((await repo.listInvoices()).map(invoice => invoice.number)).toEqual([1]);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM stock_movement WHERE reason=?').get('sale')).toMatchObject({ n: 1 });
    const second = await repo.issueInvoice('request-2', '', [{ productId: 'bag', quantity: 1 }]);
    expect(second.number).toBe(2);
    sqlite.close();
  });

  it('rejects insufficient stock without consuming an invoice number or leaving a customer', async () => {
    const { sqlite, repo } = memoryShop();
    await repo.initialize('test');
    await repo.addProduct({ id: 'bag', name: 'کیف', category: 'کیف', priceRial: 1000, stock: 1 });
    await expect(repo.issueInvoice('failed', 'مشتری', [{ productId: 'bag', quantity: 2 }])).rejects.toThrow('موجودی');
    expect(sqlite.prepare('SELECT next_number FROM invoice_counter').get()).toMatchObject({ next_number: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM customer').get()).toMatchObject({ n: 0 });
    expect((await repo.listProducts())[0].stock).toBe(1);
    sqlite.close();
  });

  it('versions editable Persian invoice fields and retains the issued snapshot', async () => {
    const { sqlite, repo } = memoryShop();
    await repo.initialize('test');
    await repo.addProduct({ id: 'bag', name: 'کیف', category: 'کیف', priceRial: 1000, stock: 2 });
    expect(await repo.saveTemplate({ storeName: 'کیف و کمربند کلاسیک', condition1: 'نسخهٔ اول' })).toBe(1);
    const first = await repo.issueInvoice('first', 'مشتری', [{ productId: 'bag', quantity: 1 }]);
    expect(first.templateFields?.condition1).toBe('نسخهٔ اول');
    expect(await repo.saveTemplate({ storeName: 'کیف و کمربند کلاسیک', condition1: 'نسخهٔ دوم' })).toBe(2);
    expect((await repo.listInvoices())[0].templateFields?.condition1).toBe('نسخهٔ اول');
    expect((await repo.loadTemplate())?.fields.condition1).toBe('نسخهٔ دوم');
    expect(sqlite.prepare('SELECT template_version_id FROM invoice_revision WHERE invoice_id=?').get('first')).toMatchObject({ template_version_id: first.templateVersionId });
    sqlite.close();
  });

  it('edits a product, records price and stock changes, and keeps archived invoice history', async () => {
    const { sqlite, repo } = memoryShop();
    await repo.initialize('test');
    await repo.addProduct({ id: 'bag', name: 'کیف', category: 'کیف', priceRial: 1000, stock: 5 });
    const issued = await repo.issueInvoice('sale', 'مریم', [{ productId: 'bag', quantity: 1 }]);
    await repo.updateProduct({ id: 'bag', name: 'کیف چرمی', category: 'چرم', priceRial: 1200, stock: 7 });
    expect(await repo.listProducts('كيف چرمي')).toMatchObject([{ id: 'bag', category: 'چرم', priceRial: 1200, stock: 7 }]);
    expect(sqlite.prepare('SELECT quantity_milli FROM stock_movement WHERE reason=?').get('adjustment')).toMatchObject({ quantity_milli: 3000 });
    expect(sqlite.prepare('SELECT old_price_rial,new_price_rial FROM price_event WHERE reason=?').get('manual')).toMatchObject({ old_price_rial: 1000, new_price_rial: 1200 });
    await repo.archiveProduct('bag');
    expect(await repo.listProducts()).toEqual([]);
    expect(await repo.listInvoices()).toEqual([issued]);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM audit_event WHERE action=?').get('archive')).toMatchObject({ n: 1 });
    sqlite.close();
  });

  it('rejects invalid product edits without writing a partial revision', async () => {
    const { sqlite, repo } = memoryShop();
    await repo.initialize('test');
    await repo.addProduct({ id: 'bag', name: 'کیف', category: 'کیف', priceRial: 1000, stock: 1 });
    await expect(repo.updateProduct({ id: 'bag', name: 'کیف جدید', category: 'چرم', priceRial: 1200, stock: -1 })).rejects.toThrow();
    expect(await repo.listProducts()).toMatchObject([{ id: 'bag', name: 'کیف', priceRial: 1000, stock: 1 }]);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM stock_movement WHERE reason=?').get('adjustment')).toMatchObject({ n: 0 });
    sqlite.close();
  });
});
