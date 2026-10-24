import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { invoiceLineAmounts, isValidJalaliDate, ShopRepository, type SqlPort, type SqlValue } from '../packages/database/src/index';

function memoryShop() {
  const sqlite = new DatabaseSync(':memory:');
  const migration = readFileSync(new URL('../packages/database/migrations/001_init.sql', import.meta.url), 'utf8');
  const detailMigration = readFileSync(new URL('../packages/database/migrations/002_product_detail.sql', import.meta.url), 'utf8');
  const archiveMigration = readFileSync(new URL('../packages/database/migrations/003_archive.sql', import.meta.url), 'utf8');
  const financeMigration = readFileSync(new URL('../packages/database/migrations/004_finance.sql', import.meta.url), 'utf8');
  sqlite.exec(migration);
  sqlite.exec(migration); // Starting the app again must not destroy or reject an existing database.
  sqlite.exec(detailMigration);
  sqlite.exec(archiveMigration);
  sqlite.exec(financeMigration);
  sqlite.exec('PRAGMA foreign_keys=ON');
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
  it('rejects impossible manual Jalali dates before issuing an invoice', () => {
    expect(isValidJalaliDate('۱۴۰۵/۰۷/۲۹')).toBe(true);
    expect(isValidJalaliDate('۱۴۰۵/۱۲/۳۱')).toBe(false);
    expect(isValidJalaliDate('۱۴۰۵/۱۳/۰۱')).toBe(false);
  });
  it('upgrades a populated v1 database to v2 without changing existing rows', () => {
    const sqlite = new DatabaseSync(':memory:');
    const v1 = readFileSync(new URL('../packages/database/migrations/001_init.sql', import.meta.url), 'utf8');
    const v2 = readFileSync(new URL('../packages/database/migrations/002_product_detail.sql', import.meta.url), 'utf8');
    sqlite.exec(v1);
    sqlite.prepare('INSERT INTO store(id,name,created_at) VALUES(?,?,?)').run('classic-bag-belt', 'کلاسیک', '2026-01-01');
    sqlite.prepare('INSERT INTO product(id,store_id,name,search_name,price_rial,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('old-bag', 'classic-bag-belt', 'کیف قدیمی', 'کیف قدیمی', 1000, '2026-01-01', '2026-01-01');
    sqlite.exec(v2);
    sqlite.exec(v1);
    expect(sqlite.prepare('SELECT name,price_rial,model,color FROM product WHERE id=?').get('old-bag')).toMatchObject({ name: 'کیف قدیمی', price_rial: 1000, model: null, color: null });
    expect(sqlite.prepare('SELECT version FROM schema_migrations ORDER BY version').all()).toEqual([{ version: 1 }, { version: 2 }]);
    sqlite.close();
  });
  it('migrates an existing catalog and stores model, color, image reference and customer contact', async () => {
    const { sqlite, repo } = memoryShop();
    await repo.initialize('test');
    await repo.addProduct({ id: 'bag', name: 'کیف چرمی', category: 'کیف/دستی', model: 'M12', color: 'قهوه‌ای', imagePath: 'product-images/bag.jpg', priceRial: 900000, stock: 2 });
    expect(await repo.listProducts('M12')).toMatchObject([{ model: 'M12', color: 'قهوه‌ای', imagePath: 'product-images/bag.jpg' }]);
    const first = await repo.issueInvoice('customer-1', 'سارا رضایی', [{ productId: 'bag', quantity: 1 }], '09123456789', '۱۴۰۵/۰۷/۲۹', 'سارا', 'رضایی', false);
    expect(first).toMatchObject({ customerPhone: '09123456789', dateJalali: '۱۴۰۵/۰۷/۲۹', showCardNumber: false });
    expect(sqlite.prepare('SELECT phone FROM customer WHERE id=(SELECT customer_id FROM invoice WHERE id=?)').get('customer-1')).toMatchObject({ phone: '09123456789' });
    expect(await repo.listCustomers('رضایی')).toMatchObject([{ firstName: 'سارا', lastName: 'رضایی', invoiceCount: 1 }]);
    expect((await repo.listCustomerInvoices((await repo.listCustomers())[0].id)).map(entry => entry.receipt.number)).toEqual([1]);
    sqlite.close();
  });
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
    expect(await repo.listInvoices()).toMatchObject([JSON.parse(JSON.stringify(issued))]);
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

  it('voids an invoice once, restores stock atomically, and keeps its immutable history', async () => {
    const { sqlite, repo } = memoryShop();
    await repo.initialize('test');
    await repo.addProduct({ id: 'bag', name: 'کیف', category: 'کیف', priceRial: 1000, stock: 3 });
    const receipt = await repo.issueInvoice('sale', 'مریم', [{ productId: 'bag', quantity: 2 }, { name: 'بسته‌بندی', unitPriceRial: 100, quantity: 1 }]);
    expect((await repo.listProducts())[0].stock).toBe(1);
    await repo.voidInvoice(receipt.id, 'اشتباه در سفارش');
    expect((await repo.listProducts())[0].stock).toBe(3);
    expect(await repo.listInvoices()).toEqual([]);
    expect(await repo.listInvoiceHistory()).toMatchObject([{ receipt: JSON.parse(JSON.stringify(receipt)), status: 'void' }]);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM stock_movement WHERE reason=?').get('void')).toMatchObject({ n: 1 });
    await expect(repo.voidInvoice(receipt.id, 'تکرار')).rejects.toThrow();
    await expect(repo.issueInvoice(receipt.id, 'مریم', [{ productId: 'bag', quantity: 1 }])).rejects.toThrow('باطل‌شده');
    expect((await repo.listProducts())[0].stock).toBe(3);
    const next = await repo.issueInvoice('next', '', [{ productId: 'bag', quantity: 1 }]);
    expect(next.number).toBe(2);
    sqlite.close();
  });

  it('rounds line discounts in whole rial and persists exact totals', async () => {
    const { sqlite, repo } = memoryShop();
    await repo.initialize('test');
    expect(invoiceLineAmounts(1001, 1, 1000)).toEqual({ subtotalRial: 1001, discountRial: 100, totalRial: 901 });
    const receipt = await repo.issueInvoice('discount', '', [{ name: 'کیف', unitPriceRial: 1001, quantity: 2, discountBasisPoints: 1000 }]);
    expect(receipt).toMatchObject({ subtotalRial: 2002, discountRial: 200, totalRial: 1802 });
    expect(sqlite.prepare('SELECT subtotal_rial,discount_rial,grand_total_rial FROM invoice_revision WHERE invoice_id=?').get('discount'))
      .toMatchObject({ subtotal_rial: 2002, discount_rial: 200, grand_total_rial: 1802 });
    await expect(repo.issueInvoice('invalid', '', [{ name: 'کیف', unitPriceRial: 100, quantity: 1, discountBasisPoints: 10001 }])).rejects.toThrow();
    sqlite.close();
  });

  it('keeps shipping, payment and balance consistent in the invoice snapshot', async () => {
    const { sqlite, repo } = memoryShop();
    await repo.initialize('test');
    const receipt = await repo.issueInvoice('paid', 'مریم', [{ name: 'کیف', quantity: 1, unitPriceRial: 1000, discountBasisPoints: 1000 }],
      '09123456789', '', '', '', true, { customerAddress: 'مشهد', paymentMethod: 'کارت', shippingRial: 50, paidRial: 300 });
    expect(receipt).toMatchObject({ subtotalRial: 1000, discountRial: 100, shippingRial: 50, totalRial: 950, paidRial: 300, balanceRial: 650, customerAddress: 'مشهد' });
    expect(sqlite.prepare('SELECT subtotal_rial,discount_rial,shipping_rial,grand_total_rial,paid_rial,balance_rial FROM invoice_revision WHERE invoice_id=?').get('paid'))
      .toMatchObject({ subtotal_rial: 1000, discount_rial: 100, shipping_rial: 50, grand_total_rial: 950, paid_rial: 300, balance_rial: 650 });
    await expect(repo.issueInvoice('too-much', '', [{ name: 'کیف', quantity: 1, unitPriceRial: 100 }], '', '', '', '', true, { paidRial: 101 })).rejects.toThrow('پرداختی');
    sqlite.close();
  });

  it('revises an issued invoice while preserving its number, date, old snapshot and stock audit', async () => {
    const { sqlite, repo } = memoryShop();
    await repo.initialize('test');
    await repo.addProduct({ id: 'bag', name: 'کیف', category: 'کیف', priceRial: 1000, stock: 4 });
    const first = await repo.issueInvoice('sale', 'مریم', [{ productId: 'bag', quantity: 1 }], '09123456789', '۱۴۰۵/۰۷/۲۹');
    const revised = await repo.reviseInvoice('sale', [{ productId: 'bag', quantity: 2, unitPriceRial: 1000, discountBasisPoints: 1000 }], 'مریم', '09123456789', '', 'اصلاح تعداد');
    expect(revised).toMatchObject({ id: first.id, number: first.number, at: first.at, dateJalali: first.dateJalali, revision: 2, totalRial: 1800 });
    expect((await repo.listProducts())[0].stock).toBe(2);
    expect((await repo.listInvoiceRevisions('sale')).map(x => x.receipt.revision)).toEqual([2, 1]);
    expect((await repo.listInvoiceRevisions('sale'))[1].receipt).toEqual(first);
    await expect(repo.reviseInvoice('sale', [{ productId: 'bag', quantity: 5 }], 'مریم', '', '', 'زیاد')).rejects.toThrow('موجودی');
    expect((await repo.listInvoiceRevisions('sale')).length).toBe(2);
    expect((await repo.listProducts())[0].stock).toBe(2);
    sqlite.close();
  });

  it('archives and restores products, customers and invoices without deleting records', async () => {
    const { sqlite, repo } = memoryShop();
    await repo.initialize('test');
    await repo.addProduct({ id: 'bag', name: 'کیف', category: 'کیف', priceRial: 1000, stock: 2 });
    const issued = await repo.issueInvoice('sale', 'مریم', [{ productId: 'bag', quantity: 1 }], '09123456789');
    const customerId = (await repo.listCustomers())[0].id;
    await repo.archiveProduct('bag');
    await repo.setCustomerArchived(customerId, true);
    await repo.setInvoiceArchived(issued.id, true);
    expect(await repo.listProducts()).toEqual([]);
    expect(await repo.listCustomers()).toEqual([]);
    expect(await repo.listInvoiceHistory()).toEqual([]);
    expect((await repo.listArchivedProducts()).map(x => x.id)).toEqual(['bag']);
    expect((await repo.listArchivedCustomers()).map(x => x.id)).toEqual([customerId]);
    expect((await repo.listArchivedInvoices()).map(x => x.receipt.id)).toEqual(['sale']);
    await repo.restoreProduct('bag');
    await repo.setCustomerArchived(customerId, false);
    await repo.setInvoiceArchived(issued.id, false);
    expect((await repo.listProducts()).map(x => x.id)).toEqual(['bag']);
    expect((await repo.listCustomers()).map(x => x.id)).toEqual([customerId]);
    expect((await repo.listInvoiceHistory()).map(x => x.receipt.id)).toEqual(['sale']);
    sqlite.close();
  });
  it('keeps partial receipts, returns, refunds and stock in one consistent invoice', async () => {
    const { sqlite, repo } = memoryShop();
    await repo.initialize('test');
    await repo.addProduct({ id: 'bag', name: 'کیف', category: 'کیف', priceRial: 1000, stock: 25 });
    const issued = await repo.issueInvoice('finance-sale', 'مریم', [{ productId: 'bag', quantity: 20 }], '09123456789', '', '', '', true,
      { paymentStatus: 'partial', paidRial: 5000, dueDateJalali: '۱۴۰۵/۰۸/۳۰' });
    expect(issued).toMatchObject({ totalRial: 20000, paidRial: 5000, balanceRial: 15000, paymentStatus: 'partial' });
    await expect(repo.recordInvoicePayment(issued.id, 16000, 'کارت')).rejects.toThrow('بیشتر');
    await repo.recordInvoicePayment(issued.id, 10000, 'کارت');
    expect((await repo.listInvoiceHistory())[0].receipt).toMatchObject({ paidRial: 15000, balanceRial: 5000, paymentStatus: 'partial' });
    const returned = await repo.returnInvoice(issued.id, [{ index: 0, quantity: 10, restock: true }], 'مرجوعی تعدادی');
    expect(returned.returnedRial).toBe(10000);
    expect((await repo.listProducts())[0].stock).toBe(15);
    expect((await repo.listReturnableLines(issued.id))[0].available).toBe(10);
    await expect(repo.returnInvoice(issued.id, [{ index: 0, quantity: 11, restock: true }], 'زیاد')).rejects.toThrow('بیشتر');
    expect((await repo.listInvoiceHistory())[0].receipt).toMatchObject({ returnedRial: 10000, paymentStatus: 'settled', balanceRial: 0 });
    await repo.refundInvoicePayment(issued.id, 5000, 'کارت');
    expect((await repo.listInvoiceHistory())[0].receipt).toMatchObject({ paidRial: 10000, refundedRial: 5000, balanceRial: 0 });
    const journals = sqlite.prepare('SELECT journal_id,SUM(debit_rial) AS debit,SUM(credit_rial) AS credit FROM finance_journal_line GROUP BY journal_id').all() as { debit: number; credit: number }[];
    expect(journals.every(item => item.debit === item.credit)).toBe(true);
    sqlite.close();
  });
  it('keeps a proforma out of stock until conversion and purges selected archive items', async () => {
    const { sqlite, repo } = memoryShop();
    await repo.initialize('test');
    await repo.addProduct({ id: 'belt', name: 'کمربند', category: 'کمربند', priceRial: 400, stock: 2 });
    const proforma = await repo.issueInvoice('draft-sale', 'رضا', [{ productId: 'belt', quantity: 1 }], '', '', '', '', true, { paymentStatus: 'proforma' });
    expect((await repo.listProducts())[0].stock).toBe(2);
    await repo.convertProforma(proforma.id);
    expect((await repo.listProducts())[0].stock).toBe(1);
    await repo.archiveProduct('belt');
    expect((await repo.purgeArchived('product', ['belt'])).deleted).toBe(1);
    await repo.compactDatabase();
    expect(await repo.listProducts()).toEqual([]);
    expect((await repo.listInvoiceHistory())[0].receipt.lines[0].name).toContain('کمربند');
    sqlite.close();
  });
  it('records purchases, supplier payments, expenses and cheques with balanced journals', async () => {
    const { sqlite, repo } = memoryShop();
    await repo.initialize('test');
    await repo.addProduct({ id: 'bag', name: 'کیف', category: 'کیف', priceRial: 1000, stock: 0 });
    const purchaseId = await repo.createPurchase('تأمین‌کننده', [{ productId: 'bag', quantity: 3, unitCostRial: 600 }], 500, '۱۴۰۵/۰۸/۳۰');
    expect((await repo.listProducts())[0].stock).toBe(3);
    expect((await repo.listFinanceOverview()).purchases[0]).toMatchObject({ totalRial: 1800, paidRial: 500 });
    await repo.recordPurchasePayment(purchaseId, 1300, 'کارت');
    await expect(repo.recordPurchasePayment(purchaseId, 1, 'کارت')).rejects.toThrow('بیشتر');
    const expenseId = await repo.createExpense('اجاره', 'ماه مهر', 1000, false, '۱۴۰۵/۰۸/۳۰');
    await repo.settleExpense(expenseId);
    const chequeId = await repo.createCheque({ direction: 'received', party: 'مشتری', serial: '1001', bank: 'بانک', amountRial: 2000, dueJalali: '۱۴۰۵/۰۸/۳۰', note: '' });
    await repo.setChequeStatus(chequeId, 'cleared');
    const overview = await repo.listFinanceOverview();
    expect(overview.purchases[0].paidRial).toBe(1800);
    expect(overview.expenses[0].settled).toBe(true);
    expect(overview.cheques[0].status).toBe('cleared');
    const journals = sqlite.prepare('SELECT journal_id,SUM(debit_rial) AS debit,SUM(credit_rial) AS credit FROM finance_journal_line GROUP BY journal_id').all() as { debit: number; credit: number }[];
    expect(journals.every(item => item.debit === item.credit)).toBe(true);
    sqlite.close();
  });
});
