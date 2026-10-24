import { assertRial, changedPrice, type PriceBatch, type PriceEvent, type Product } from '@majora/domain';

export type SqlValue = string | number | null;
export interface SqlPort {
  execute(sql: string): Promise<void>;
  run(sql: string, values?: SqlValue[]): Promise<{ changes: number }>;
  query<T>(sql: string, values?: SqlValue[]): Promise<T[]>;
  transaction<T>(work: () => Promise<T>): Promise<T>;
}
type ProductRow = { id: string; name: string; category: string | null; model: string | null; color: string | null; image_path: string | null; price_rial: number; quantity_milli: number; archived_at: string | null };
type EventRow = { id: string; batch_id: string; product_id: string; old_price_rial: number; new_price_rial: number; created_at: string; reason: string };
type BatchRow = { id: string; percent_basis_points: number; created_at: string; scope: string; source_batch_id: string | null; product_ids: string | null; undone_at: string | null };
export type InvoiceInputLine = { productId?: string; name?: string; unitPriceRial?: number; quantity: number; discountBasisPoints?: number };
export type PaymentStatus = 'settled' | 'partial' | 'unpaid' | 'proforma';
export type InvoiceDetails = { customerAddress?: string; paymentMethod?: string; dueDateJalali?: string; shippingRial?: number; paidRial?: number; showCardNumber?: boolean; paymentStatus?: PaymentStatus };
export type InvoiceReceipt = { id: string; number: number; at: string; dateJalali?: string; customerName: string; customerPhone?: string; customerAddress?: string; paymentMethod?: string; dueDateJalali?: string; showCardNumber?: boolean; paymentStatus?: PaymentStatus; returnedRial?: number; refundedRial?: number; lines: { productId?: string; name: string; model?: string; color?: string; quantity: number; unitPriceRial: number; discountBasisPoints?: number; discountRial?: number; totalRial: number }[]; subtotalRial?: number; discountRial?: number; shippingRial?: number; paidRial?: number; balanceRial?: number; totalRial: number; revision?: number; templateVersionId?: string; templateFields?: Record<string, string> };
export type InvoiceHistoryEntry = { receipt: InvoiceReceipt; status: 'issued' | 'void' };
export type FinanceOverview = { invoices: InvoiceReceipt[]; purchases: PurchaseEntry[]; expenses: ExpenseEntry[]; cheques: ChequeEntry[] };
export type PurchaseEntry = { id: string; supplier: string; totalRial: number; paidRial: number; dueJalali: string; note: string; createdAt: string };
export type ExpenseEntry = { id: string; category: string; description: string; amountRial: number; settled: boolean; dueJalali: string; createdAt: string };
export type ChequeEntry = { id: string; direction: 'received' | 'issued'; party: string; serial: string; bank: string; amountRial: number; dueJalali: string; status: 'open' | 'cleared' | 'returned' | 'cancelled'; note: string; createdAt: string };
export type ReturnLineInput = { index: number; quantity: number; restock: boolean };
export type CustomerSummary = { id: string; name: string; firstName: string; lastName: string; phone: string; invoiceCount: number; lastPurchaseAt: string | null; createdAt?: string };

export function normalizeSearch(input: string): string {
  return input.normalize('NFKC').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[\u200c\s]+/g, ' ').trim().toLocaleLowerCase('fa-IR');
}

export function invoiceLineAmounts(unitPriceRial: number, quantity: number, discountBasisPoints = 0): { subtotalRial: number; discountRial: number; totalRial: number } {
  assertRial(unitPriceRial);
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isSafeInteger(discountBasisPoints) || discountBasisPoints < 0 || discountBasisPoints > 10000) throw new Error('تعداد یا درصد تخفیف نامعتبر است.');
  const subtotal = BigInt(unitPriceRial) * BigInt(quantity);
  if (subtotal > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('مبلغ ردیف بیش از حد مجاز است.');
  const discount = (subtotal * BigInt(discountBasisPoints) + 5000n) / 10000n;
  return { subtotalRial: Number(subtotal), discountRial: Number(discount), totalRial: Number(subtotal - discount) };
}

export function isValidJalaliDate(input: string): boolean {
  const normalized = input.replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 1776)).replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 1632));
  const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(normalized);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  if (year < 1200 || year > 1600 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const formatter = new Intl.DateTimeFormat('en-US-u-ca-persian', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' });
  const start = Date.UTC(year + 621, 2, 15);
  for (let offset = 0; offset < 375; offset++) {
    const parts = formatter.formatToParts(new Date(start + offset * 86_400_000));
    const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
    if (Number(value.year) === year && Number(value.month) === month && Number(value.day) === day) return true;
  }
  return false;
}

export class ShopRepository {
  constructor(private readonly db: SqlPort, private readonly storeId = 'classic-bag-belt') {}

  async initialize(name: string): Promise<void> {
    await this.db.run('INSERT OR IGNORE INTO store(id,name,created_at) VALUES(?,?,?)', [this.storeId, name, new Date().toISOString()]);
    await this.db.run('INSERT OR IGNORE INTO invoice_counter(store_id,next_number) VALUES(?,1)', [this.storeId]);
  }

  async loadTemplate(): Promise<{ id: string; version: number; fields: Record<string, string> } | null> {
    const versions = await this.db.query<{ id: string; version_no: number }>(`SELECT id,version_no FROM template_version
      WHERE store_id=? AND palette='color' ORDER BY version_no DESC LIMIT 1`, [this.storeId]);
    if (!versions.length) return null;
    const rows = await this.db.query<{ field_key: string; value_text: string | null }>('SELECT field_key,value_text FROM template_field WHERE template_version_id=?', [versions[0].id]);
    return { id: versions[0].id, version: versions[0].version_no, fields: Object.fromEntries(rows.map(row => [row.field_key, row.value_text ?? ''])) };
  }

  async saveTemplate(fields: Record<string, string>): Promise<number> {
    const entries = Object.entries(fields);
    if (!entries.length || entries.some(([key, value]) => !/^[A-Za-z][A-Za-z0-9]*$/.test(key) || typeof value !== 'string' || value.length > 5000)) throw new Error('فیلد قالب نامعتبر است.');
    return this.db.transaction(async () => {
      const current = await this.db.query<{ next_version: number }>(`SELECT COALESCE(MAX(version_no),0)+1 AS next_version FROM template_version
        WHERE store_id=? AND palette='color'`, [this.storeId]);
      const version = current[0].next_version; const id = crypto.randomUUID(); const now = new Date().toISOString();
      await this.db.run('INSERT INTO template_version(id,store_id,version_no,palette,created_at) VALUES(?,?,?,?,?)', [id, this.storeId, version, 'color', now]);
      for (const [index, [key, value]] of entries.entries()) {
        const section = key.startsWith('condition') ? 'conditions' : 'identity';
        await this.db.run(`INSERT INTO template_field(template_version_id,field_key,section_key,label,value_text,visible,sort_order,bounds_json)
          VALUES(?,?,?,?,?,?,?,?)`, [id, key, section, key, value, 1, index, '{"mode":"flow"}']);
      }
      await this.audit('template_version', id, 'save', { version, fieldCount: entries.length }, now);
      return version;
    });
  }

  async listProducts(search = ''): Promise<Product[]> {
    const normalized = normalizeSearch(search);
    const rows = await this.db.query<ProductRow>(`SELECT p.id,p.name,COALESCE(c.name,'بدون دسته') AS category,p.model,p.color,p.image_path,p.price_rial,
      COALESCE(s.quantity_milli,0) AS quantity_milli,p.archived_at FROM product p
      LEFT JOIN category c ON c.id=p.category_id LEFT JOIN stock_balance s ON s.product_id=p.id
      WHERE p.store_id=? AND p.archived_at IS NULL AND p.search_name LIKE ? ORDER BY p.updated_at DESC`, [this.storeId, `%${normalized}%`]);
    return rows.map(r => ({ id: r.id, name: r.name, category: r.category ?? 'بدون دسته', model: r.model ?? '', color: r.color ?? '', imagePath: r.image_path ?? undefined, priceRial: r.price_rial, stock: r.quantity_milli / 1000 }));
  }

  async addProduct(input: Product): Promise<void> {
    assertRial(input.priceRial);
    if (!input.name.trim() || !Number.isSafeInteger(input.stock) || input.stock < 0) throw new Error('نام یا موجودی کالا نامعتبر است.');
    const now = new Date().toISOString();
    await this.db.transaction(async () => {
      let categoryId: string | null = null;
      if (input.category.trim() && input.category !== 'بدون دسته') {
        const existing = await this.db.query<{ id: string }>('SELECT id FROM category WHERE store_id=? AND name=? AND archived_at IS NULL LIMIT 1', [this.storeId, input.category.trim()]);
        categoryId = existing[0]?.id ?? crypto.randomUUID();
        if (!existing.length) await this.db.run('INSERT INTO category(id,store_id,name) VALUES(?,?,?)', [categoryId, this.storeId, input.category.trim()]);
      }
      await this.db.run(`INSERT INTO product(id,store_id,category_id,name,search_name,model,color,image_path,price_rial,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`, [input.id, this.storeId, categoryId, input.name.trim(), normalizeSearch(`${input.name} ${input.model ?? ''} ${input.color ?? ''}`), input.model?.trim() ?? '', input.color?.trim() ?? '', input.imagePath ?? null, input.priceRial, now, now]);
      await this.db.run('INSERT INTO stock_balance(product_id,quantity_milli) VALUES(?,?)', [input.id, input.stock * 1000]);
      if (input.stock > 0) await this.db.run('INSERT INTO stock_movement(id,product_id,quantity_milli,reason,created_at) VALUES(?,?,?,?,?)', [crypto.randomUUID(), input.id, input.stock * 1000, 'opening', now]);
      await this.audit('product', input.id, 'create', { name: input.name, priceRial: input.priceRial, stock: input.stock }, now);
    });
  }

  async updateProduct(input: Product): Promise<void> {
    assertRial(input.priceRial);
    const name = input.name.trim();
    const category = input.category.trim();
    if (!name || !Number.isSafeInteger(input.stock) || input.stock < 0 || !Number.isSafeInteger(input.stock * 1000)) {
      throw new Error('نام یا موجودی کالا نامعتبر است.');
    }
    await this.db.transaction(async () => {
      const rows = await this.db.query<{ name: string; price_rial: number; quantity_milli: number; revision: number }>(
        `SELECT p.name,p.price_rial,s.quantity_milli,p.revision FROM product p
         JOIN stock_balance s ON s.product_id=p.id WHERE p.id=? AND p.store_id=? AND p.archived_at IS NULL`,
        [input.id, this.storeId]
      );
      if (!rows.length) throw new Error('کالا پیدا نشد.');
      const current = rows[0];
      let categoryId: string | null = null;
      if (category && category !== 'بدون دسته') {
        const matches = await this.db.query<{ id: string }>('SELECT id FROM category WHERE store_id=? AND name=? AND archived_at IS NULL LIMIT 1', [this.storeId, category]);
        categoryId = matches[0]?.id ?? crypto.randomUUID();
        if (!matches.length) await this.db.run('INSERT INTO category(id,store_id,name) VALUES(?,?,?)', [categoryId, this.storeId, category]);
      }
      const at = new Date().toISOString();
      const updated = await this.db.run(
        `UPDATE product SET name=?,search_name=?,category_id=?,model=?,color=?,image_path=?,price_rial=?,updated_at=?,revision=revision+1
         WHERE id=? AND store_id=? AND revision=? AND archived_at IS NULL`,
        [name, normalizeSearch(`${name} ${input.model ?? ''} ${input.color ?? ''}`), categoryId, input.model?.trim() ?? '', input.color?.trim() ?? '', input.imagePath ?? null, input.priceRial, at, input.id, this.storeId, current.revision]
      );
      if (updated.changes !== 1) throw new Error('کالا هم‌زمان تغییر کرده است.');
      if (current.price_rial !== input.priceRial) {
        const batchId = crypto.randomUUID();
        await this.db.run('INSERT INTO price_batch(id,store_id,percent_basis_points,scope,created_at,actor) VALUES(?,?,?,?,?,?)', [batchId, this.storeId, 0, 'selected', at, 'owner']);
        await this.db.run('INSERT INTO price_event(id,batch_id,product_id,old_price_rial,new_price_rial,reason,created_at) VALUES(?,?,?,?,?,?,?)', [crypto.randomUUID(), batchId, input.id, current.price_rial, input.priceRial, 'manual', at]);
      }
      const nextQuantity = input.stock * 1000;
      const delta = nextQuantity - current.quantity_milli;
      if (delta) {
        const balance = await this.db.run('UPDATE stock_balance SET quantity_milli=? WHERE product_id=? AND quantity_milli=?', [nextQuantity, input.id, current.quantity_milli]);
        if (balance.changes !== 1) throw new Error('موجودی هم‌زمان تغییر کرده است.');
        await this.db.run('INSERT INTO stock_movement(id,product_id,quantity_milli,reason,created_at) VALUES(?,?,?,?,?)', [crypto.randomUUID(), input.id, delta, 'adjustment', at]);
      }
      await this.audit('product', input.id, 'update', {
        previous: { name: current.name, priceRial: current.price_rial, stock: current.quantity_milli / 1000 },
        next: { name, category, priceRial: input.priceRial, stock: input.stock }
      }, at);
    });
  }

  async archiveProduct(productId: string): Promise<void> {
    await this.db.transaction(async () => {
      const at = new Date().toISOString();
      const result = await this.db.run('UPDATE product SET archived_at=?,updated_at=?,revision=revision+1 WHERE id=? AND store_id=? AND archived_at IS NULL', [at, at, productId, this.storeId]);
      if (result.changes !== 1) throw new Error('کالای فعال پیدا نشد.');
      await this.audit('product', productId, 'archive', {}, at);
    });
  }

  async listArchivedProducts(): Promise<Product[]> {
    const rows = await this.db.query<ProductRow>(`SELECT p.id,p.name,COALESCE(c.name,'بدون دسته') AS category,p.model,p.color,p.image_path,p.price_rial,
      COALESCE(s.quantity_milli,0) AS quantity_milli,p.archived_at FROM product p
      LEFT JOIN category c ON c.id=p.category_id LEFT JOIN stock_balance s ON s.product_id=p.id
      WHERE p.store_id=? AND p.archived_at IS NOT NULL ORDER BY p.archived_at DESC`, [this.storeId]);
    return rows.map(r => ({ id: r.id, name: r.name, category: r.category ?? 'بدون دسته', model: r.model ?? '', color: r.color ?? '', imagePath: r.image_path ?? undefined, priceRial: r.price_rial, stock: r.quantity_milli / 1000, archived: true }));
  }

  async listProductPhotoPaths(): Promise<string[]> {
    const rows = await this.db.query<{ image_path: string }>('SELECT DISTINCT image_path FROM product WHERE store_id=? AND image_path IS NOT NULL', [this.storeId]);
    return rows.map(row => row.image_path).filter(path => /^product-images\/[a-f0-9-]+\.jpg$/.test(path));
  }

  async restoreProduct(productId: string): Promise<void> {
    await this.db.transaction(async () => {
      const at = new Date().toISOString();
      const result = await this.db.run('UPDATE product SET archived_at=NULL,updated_at=?,revision=revision+1 WHERE id=? AND store_id=? AND archived_at IS NOT NULL', [at, productId, this.storeId]);
      if (result.changes !== 1) throw new Error('کالای بایگانی‌شده پیدا نشد.');
      await this.audit('product', productId, 'restore', {}, at);
    });
  }

  async updatePrice(productId: string, newPriceRial: number): Promise<void> {
    assertRial(newPriceRial);
    await this.db.transaction(async () => {
      const product = await this.db.query<{ price_rial: number }>('SELECT price_rial FROM product WHERE id=? AND store_id=? AND archived_at IS NULL', [productId, this.storeId]);
      if (!product.length) throw new Error('کالا پیدا نشد.');
      const previous = product[0].price_rial;
      const now = new Date().toISOString(); const batchId = crypto.randomUUID();
      await this.db.run('INSERT INTO price_batch(id,store_id,percent_basis_points,scope,created_at,actor) VALUES(?,?,?,?,?,?)', [batchId, this.storeId, 0, 'selected', now, 'owner']);
      await this.db.run('INSERT INTO price_event(id,batch_id,product_id,old_price_rial,new_price_rial,reason,created_at) VALUES(?,?,?,?,?,?,?)', [crypto.randomUUID(), batchId, productId, previous, newPriceRial, 'manual', now]);
      const update = await this.db.run('UPDATE product SET price_rial=?,updated_at=?,revision=revision+1 WHERE id=? AND price_rial=?', [newPriceRial, now, productId, previous]);
      if (update.changes !== 1) throw new Error('قیمت هم‌زمان تغییر کرده است.');
      await this.audit('product', productId, 'price_manual', { old: previous, next: newPriceRial }, now);
    });
  }

  async changePrices(ids: string[], basisPoints: number): Promise<{ batch: PriceBatch; events: PriceEvent[] }> {
    if (!ids.length || new Set(ids).size !== ids.length) throw new Error('انتخاب کالا نامعتبر است.');
    const batchId = crypto.randomUUID(); const at = new Date().toISOString();
    return this.db.transaction(async () => {
      const placeholders = ids.map(() => '?').join(',');
      const rows = await this.db.query<{ id: string; price_rial: number }>(`SELECT id,price_rial FROM product WHERE store_id=? AND archived_at IS NULL AND id IN (${placeholders})`, [this.storeId, ...ids]);
      if (rows.length !== ids.length) throw new Error('یکی از کالاها تغییر کرده یا پیدا نشد.');
      await this.db.run('INSERT INTO price_batch(id,store_id,percent_basis_points,scope,created_at,actor) VALUES(?,?,?,?,?,?)', [batchId, this.storeId, basisPoints, 'selected', at, 'owner']);
      const events: PriceEvent[] = [];
      for (const row of rows) {
        const next = changedPrice(row.price_rial, basisPoints);
        const event: PriceEvent = { id: crypto.randomUUID(), batchId, productId: row.id, oldPriceRial: row.price_rial, newPriceRial: next, at, kind: 'raise' };
        await this.db.run('INSERT INTO price_event(id,batch_id,product_id,old_price_rial,new_price_rial,reason,created_at) VALUES(?,?,?,?,?,?,?)', [event.id, batchId, row.id, row.price_rial, next, 'bulk', at]);
        const update = await this.db.run('UPDATE product SET price_rial=?,updated_at=?,revision=revision+1 WHERE id=? AND price_rial=?', [next, at, row.id, row.price_rial]);
        if (update.changes !== 1) throw new Error('تعارض هم‌زمان قیمت؛ عملیات لغو شد.');
        events.push(event);
      }
      await this.audit('price_batch', batchId, 'apply', { basisPoints, productIds: ids }, at);
      return { batch: { id: batchId, percentBasisPoints: basisPoints, at, productIds: ids }, events };
    });
  }

  async listPriceHistory(): Promise<{ batches: PriceBatch[]; events: PriceEvent[] }> {
    const rows = await this.db.query<BatchRow>(`SELECT b.id,b.percent_basis_points,b.created_at,b.scope,b.source_batch_id,
      (SELECT group_concat(product_id) FROM price_event WHERE batch_id=b.id) AS product_ids,
      (SELECT created_at FROM price_batch u WHERE u.source_batch_id=b.id LIMIT 1) AS undone_at
      FROM price_batch b WHERE b.store_id=? ORDER BY b.created_at DESC`, [this.storeId]);
    const events = await this.db.query<EventRow>(`SELECT e.* FROM price_event e JOIN price_batch b ON b.id=e.batch_id WHERE b.store_id=? ORDER BY e.created_at`, [this.storeId]);
    return {
      batches: rows.filter(r => r.scope !== 'undo' && r.percent_basis_points !== 0).map(r => ({ id: r.id, percentBasisPoints: r.percent_basis_points, at: r.created_at, productIds: r.product_ids?.split(',') ?? [], undoneAt: r.undone_at ?? undefined })),
      events: events.map(r => ({ id: r.id, batchId: r.batch_id, productId: r.product_id, oldPriceRial: r.old_price_rial, newPriceRial: r.new_price_rial, at: r.created_at, kind: r.reason === 'undo' ? 'undo' : 'raise' }))
    };
  }

  async undoPrices(sourceBatchId: string): Promise<{ restored: number; conflicts: string[] }> {
    const at = new Date().toISOString(); const undoBatchId = crypto.randomUUID();
    return this.db.transaction(async () => {
      const already = await this.db.query<{ id: string }>('SELECT id FROM price_batch WHERE source_batch_id=? LIMIT 1', [sourceBatchId]);
      if (already.length) throw new Error('این عملیات قبلاً بازگردانی شده است.');
      const source = await this.db.query<EventRow>(`SELECT e.* FROM price_event e JOIN price_batch b ON b.id=e.batch_id
        WHERE b.id=? AND b.store_id=? AND e.reason='bulk'`, [sourceBatchId, this.storeId]);
      if (!source.length) throw new Error('عملیات قیمت پیدا نشد.');
      const conflicts: string[] = []; let restored = 0;
      await this.db.run('INSERT INTO price_batch(id,store_id,percent_basis_points,scope,source_batch_id,created_at,actor) VALUES(?,?,?,?,?,?,?)', [undoBatchId, this.storeId, 0, 'undo', sourceBatchId, at, 'owner']);
      for (const event of source) {
        const current = await this.db.query<{ price_rial: number }>('SELECT price_rial FROM product WHERE id=? AND archived_at IS NULL', [event.product_id]);
        if (current[0]?.price_rial !== event.new_price_rial) { conflicts.push(event.product_id); continue; }
        await this.db.run('INSERT INTO price_event(id,batch_id,product_id,old_price_rial,new_price_rial,reason,created_at) VALUES(?,?,?,?,?,?,?)', [crypto.randomUUID(), undoBatchId, event.product_id, event.new_price_rial, event.old_price_rial, 'undo', at]);
        const result = await this.db.run('UPDATE product SET price_rial=?,updated_at=?,revision=revision+1 WHERE id=? AND price_rial=?', [event.old_price_rial, at, event.product_id, event.new_price_rial]);
        if (result.changes !== 1) throw new Error('تعارض هم‌زمان قیمت؛ عملیات لغو شد.');
        restored++;
      }
      await this.audit('price_batch', undoBatchId, 'undo', { sourceBatchId, restored, conflicts }, at);
      return { restored, conflicts };
    });
  }

  /** requestId is retained by the caller until a response, making retries safe after interruption. */
  async issueInvoice(requestId: string, customerName: string, inputLines: InvoiceInputLine[], customerPhone = '', dateJalali = '', customerFirstName = '', customerLastName = '', showCardNumber = true, details: InvoiceDetails = {}): Promise<InvoiceReceipt> {
    if (!requestId || !inputLines.length) throw new Error('فاکتور باید شناسه و دست‌کم یک ردیف داشته باشد.');
    if (inputLines.some(line => !Number.isSafeInteger(line.quantity) || line.quantity <= 0 || !Number.isSafeInteger(line.quantity * 1000))) throw new Error('تعداد کالا نامعتبر است.');
    if (customerPhone && !/^\+?[0-9۰-۹٠-٩\s-]{7,20}$/.test(customerPhone)) throw new Error('شمارهٔ تماس مشتری نامعتبر است.');
    if (dateJalali && !isValidJalaliDate(dateJalali)) throw new Error('تاریخ شمسی نامعتبر است؛ سال/ماه/روز را بررسی کنید.');
    if (details.dueDateJalali && !isValidJalaliDate(details.dueDateJalali)) throw new Error('تاریخ سررسید نامعتبر است.');
    assertRial(details.shippingRial ?? 0); assertRial(details.paidRial ?? 0);
    const requestedStatus = details.paymentStatus;
    if (requestedStatus && !(['settled', 'partial', 'unpaid', 'proforma'] as string[]).includes(requestedStatus)) throw new Error('وضعیت پرداخت نامعتبر است.');
    return this.db.transaction(async () => {
      const previous = await this.db.query<{ snapshot_json: string; status: string }>(`SELECT r.snapshot_json,i.status FROM invoice i JOIN invoice_revision r ON r.invoice_id=i.id
        WHERE i.id=? AND i.store_id=? AND r.revision_no=1`, [requestId, this.storeId]);
      if (previous.length && previous[0].status !== 'issued') throw new Error('این شناسه به فاکتور باطل‌شده تعلق دارد.');
      if (previous.length) return JSON.parse(previous[0].snapshot_json) as InvoiceReceipt;
      const now = new Date().toISOString();
      const counter = await this.db.query<{ next_number: number }>('SELECT next_number FROM invoice_counter WHERE store_id=?', [this.storeId]);
      if (!counter.length) throw new Error('شماره‌گذار فاکتور آماده نیست.');
      const number = counter[0].next_number;
      const increment = await this.db.run('UPDATE invoice_counter SET next_number=next_number+1 WHERE store_id=? AND next_number=?', [this.storeId, number]);
      if (increment.changes !== 1) throw new Error('شمارهٔ فاکتور هم‌زمان تغییر کرده است.');
      const lines: InvoiceReceipt['lines'] = [];
      for (const input of inputLines) {
        let name = input.name?.trim() ?? '';
        let price = input.unitPriceRial;
        let model = '';
        let color = '';
        if (input.productId) {
          const products = await this.db.query<{ name: string; model: string | null; color: string | null; price_rial: number }>('SELECT name,model,color,price_rial FROM product WHERE id=? AND store_id=? AND archived_at IS NULL', [input.productId, this.storeId]);
          if (!products.length) throw new Error('کالای انتخابی پیدا نشد.');
          name = products[0].name;
          model = products[0].model ?? '';
          color = products[0].color ?? '';
          price = input.unitPriceRial ?? products[0].price_rial;
        }
        if (!name || price === undefined) throw new Error('شرح و قیمت ردیف دستی لازم است.');
        assertRial(price);
        const amounts = invoiceLineAmounts(price, input.quantity, input.discountBasisPoints);
        lines.push({ productId: input.productId, name: [name, model, color].filter(Boolean).join(' · '), model, color, quantity: input.quantity, unitPriceRial: price, discountBasisPoints: input.discountBasisPoints ?? 0, discountRial: amounts.discountRial, totalRial: amounts.totalRial });
      }
      const subtotal = lines.reduce((sum, line) => sum + BigInt(line.unitPriceRial) * BigInt(line.quantity), 0n);
      const discount = lines.reduce((sum, line) => sum + BigInt(line.discountRial ?? 0), 0n);
      const total = subtotal - discount + BigInt(details.shippingRial ?? 0);
      if (subtotal > BigInt(Number.MAX_SAFE_INTEGER) || total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('مجموع فاکتور بیش از حد مجاز است.');
      if (BigInt(details.paidRial ?? 0) > total) throw new Error('مبلغ پرداختی از مبلغ نهایی بیشتر است.');
      const paidRial = details.paidRial ?? 0;
      const paymentStatus: PaymentStatus = requestedStatus ?? (paidRial >= Number(total) ? 'settled' : paidRial > 0 ? 'partial' : 'unpaid');
      if ((paymentStatus === 'settled' && paidRial !== Number(total)) ||
          (paymentStatus === 'partial' && (paidRial <= 0 || paidRial >= Number(total))) ||
          ((paymentStatus === 'unpaid' || paymentStatus === 'proforma') && paidRial !== 0)) throw new Error('وضعیت پرداخت با مبلغ دریافتی سازگار نیست.');
      if (requestedStatus && (paymentStatus === 'partial' || paymentStatus === 'unpaid') && !details.dueDateJalali) throw new Error('برای ماندهٔ فاکتور تاریخ سررسید تعیین کنید.');
      const template = await this.loadTemplate();
      const receipt: InvoiceReceipt = { id: requestId, number, at: now, dateJalali: dateJalali || new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now)), customerName: customerName.trim(), customerPhone: customerPhone.trim(),
        customerAddress: details.customerAddress?.trim() ?? '', paymentMethod: details.paymentMethod?.trim() ?? '', dueDateJalali: details.dueDateJalali ?? '',
        showCardNumber: details.showCardNumber ?? showCardNumber, lines, subtotalRial: Number(subtotal), discountRial: Number(discount), shippingRial: details.shippingRial ?? 0,
        paidRial, balanceRial: Number(total) - paidRial, paymentStatus, totalRial: Number(total), revision: 1, templateVersionId: template?.id, templateFields: template?.fields };
      let customerId: string | null = null;
      if (receipt.customerName) {
        const existing = receipt.customerPhone ? await this.db.query<{ id: string }>('SELECT id FROM customer WHERE store_id=? AND phone=? AND archived_at IS NULL ORDER BY created_at LIMIT 1', [this.storeId, receipt.customerPhone]) : [];
        customerId = existing[0]?.id ?? crypto.randomUUID();
        if (!existing.length) await this.db.run('INSERT INTO customer(id,store_id,name,first_name,last_name,phone,address,created_at) VALUES(?,?,?,?,?,?,?,?)', [customerId, this.storeId, receipt.customerName, customerFirstName.trim() || null, customerLastName.trim() || null, receipt.customerPhone || null, receipt.customerAddress || null, now]);
        else if (customerFirstName.trim() && customerLastName.trim()) await this.db.run('UPDATE customer SET name=?,first_name=?,last_name=? WHERE id=? AND store_id=?', [receipt.customerName, customerFirstName.trim(), customerLastName.trim(), customerId, this.storeId]);
      }
      const revisionId = crypto.randomUUID();
      await this.db.run(`INSERT INTO invoice(id,store_id,customer_id,invoice_number,status,current_revision,created_at,issued_at)
        VALUES(?,?,?,?,?,?,?,?)`, [requestId, this.storeId, customerId, number, 'issued', 1, now, now]);
      await this.db.run(`INSERT INTO invoice_revision(id,invoice_id,revision_no,template_version_id,snapshot_json,subtotal_rial,discount_rial,shipping_rial,grand_total_rial,paid_rial,balance_rial,reason,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, [revisionId, requestId, 1, template?.id ?? null, JSON.stringify(receipt), receipt.subtotalRial!, receipt.discountRial!, receipt.shippingRial!, receipt.totalRial, receipt.paidRial!, receipt.balanceRial!, 'issue', now]);
      await this.db.run('INSERT INTO invoice_finance(invoice_id,status,paid_rial,due_jalali,updated_at) VALUES(?,?,?,?,?)', [requestId, paymentStatus, paidRial, details.dueDateJalali || null, now]);
      if (receipt.paidRial) await this.db.run('INSERT INTO payment(id,invoice_revision_id,amount_rial,method,paid_at) VALUES(?,?,?,?,?)', [crypto.randomUUID(), revisionId, receipt.paidRial, receipt.paymentMethod || 'other', now]);
      if (paidRial) await this.db.run('INSERT INTO invoice_payment_event(id,invoice_id,amount_rial,direction,method,created_at) VALUES(?,?,?,?,?,?)', [crypto.randomUUID(), requestId, paidRial, 'receive', receipt.paymentMethod || 'other', now]);
      for (const line of lines) {
        await this.db.run(`INSERT INTO invoice_line(id,invoice_revision_id,product_id,name_snapshot,color_snapshot,unit_snapshot,quantity_milli,unit_price_rial,discount_rial,line_total_rial)
          VALUES(?,?,?,?,?,?,?,?,?,?)`, [crypto.randomUUID(), revisionId, line.productId ?? null, line.name, line.color ?? null, 'عدد', line.quantity * 1000, line.unitPriceRial, line.discountRial ?? 0, line.totalRial]);
        if (line.productId && paymentStatus !== 'proforma') {
          const quantityMilli = line.quantity * 1000;
          if (!Number.isSafeInteger(quantityMilli)) throw new Error('تعداد کالا بیش از حد مجاز است.');
          const result = await this.db.run('UPDATE stock_balance SET quantity_milli=quantity_milli-? WHERE product_id=? AND quantity_milli>=?', [quantityMilli, line.productId, quantityMilli]);
          if (result.changes !== 1) throw new Error(`موجودی «${line.name}» کافی نیست.`);
          await this.db.run('INSERT INTO stock_movement(id,product_id,quantity_milli,reason,invoice_revision_id,created_at) VALUES(?,?,?,?,?,?)', [crypto.randomUUID(), line.productId, -quantityMilli, 'sale', revisionId, now]);
        }
      }
      if (paymentStatus !== 'proforma' && receipt.totalRial > 0) {
        await this.journal('sale', requestId, `فروش فاکتور ${number}`, now, [
          { account: 'receivable', debit: receipt.totalRial },
          { account: 'sales', credit: receipt.totalRial - (receipt.shippingRial ?? 0) },
          { account: 'shipping_income', credit: receipt.shippingRial ?? 0 }
        ]);
        if (paidRial) await this.journal('receipt', requestId, `دریافت فاکتور ${number}`, now, [
          { account: 'cash_bank', debit: paidRial }, { account: 'receivable', credit: paidRial }
        ]);
      }
      await this.audit('invoice', requestId, 'issue', { number, totalRial: receipt.totalRial }, now);
      return receipt;
    });
  }

  async listInvoices(): Promise<InvoiceReceipt[]> {
    const rows = await this.db.query<{ snapshot_json: string }>(`SELECT r.snapshot_json FROM invoice i JOIN invoice_revision r ON r.invoice_id=i.id
      WHERE i.store_id=? AND i.status='issued' AND i.archived_at IS NULL AND r.revision_no=i.current_revision ORDER BY i.invoice_number DESC`, [this.storeId]);
    return this.enrichReceipts(rows.map(row => JSON.parse(row.snapshot_json) as InvoiceReceipt));
  }

  async listInvoiceHistory(): Promise<InvoiceHistoryEntry[]> {
    const rows = await this.db.query<{ snapshot_json: string; status: 'issued' | 'void' }>(
      `SELECT r.snapshot_json,i.status FROM invoice i JOIN invoice_revision r ON r.invoice_id=i.id
       WHERE i.store_id=? AND i.status IN ('issued','void') AND i.archived_at IS NULL AND r.revision_no=i.current_revision
       ORDER BY i.invoice_number DESC`, [this.storeId]);
    const receipts = await this.enrichReceipts(rows.map(row => JSON.parse(row.snapshot_json) as InvoiceReceipt));
    return rows.map((row, index) => ({ receipt: receipts[index], status: row.status }));
  }

  async listArchivedInvoices(): Promise<InvoiceHistoryEntry[]> {
    const rows = await this.db.query<{ snapshot_json: string; status: 'issued' | 'void' }>(
      `SELECT r.snapshot_json,i.status FROM invoice i JOIN invoice_revision r ON r.invoice_id=i.id AND r.revision_no=i.current_revision
       WHERE i.store_id=? AND i.archived_at IS NOT NULL ORDER BY i.archived_at DESC`, [this.storeId]);
    const receipts = await this.enrichReceipts(rows.map(row => JSON.parse(row.snapshot_json) as InvoiceReceipt));
    return rows.map((row, index) => ({ receipt: receipts[index], status: row.status }));
  }

  async listInvoiceRevisions(invoiceId: string): Promise<{ receipt: InvoiceReceipt; reason: string; revisedAt: string }[]> {
    const rows = await this.db.query<{ snapshot_json: string; reason: string; created_at: string }>(
      `SELECT r.snapshot_json,r.reason,r.created_at FROM invoice_revision r JOIN invoice i ON i.id=r.invoice_id
       WHERE i.id=? AND i.store_id=? ORDER BY r.revision_no DESC`, [invoiceId, this.storeId]);
    return rows.map(row => ({ receipt: JSON.parse(row.snapshot_json) as InvoiceReceipt, reason: row.reason, revisedAt: row.created_at }));
  }

  async setInvoiceArchived(invoiceId: string, archived: boolean): Promise<void> {
    await this.db.transaction(async () => {
      const at = new Date().toISOString();
      const result = await this.db.run(`UPDATE invoice SET archived_at=? WHERE id=? AND store_id=? AND ${archived ? 'archived_at IS NULL' : 'archived_at IS NOT NULL'}`,
        [archived ? at : null, invoiceId, this.storeId]);
      if (result.changes !== 1) throw new Error('فاکتور در وضعیت مورد انتظار پیدا نشد.');
      await this.audit('invoice', invoiceId, archived ? 'archive' : 'restore', {}, at);
    });
  }

  async listCustomers(search = ''): Promise<CustomerSummary[]> {
    const needle = normalizeSearch(search);
    const rows = await this.db.query<{ id: string; name: string; first_name: string | null; last_name: string | null; phone: string | null; invoice_count: number; last_purchase_at: string | null; created_at: string }>(
      `SELECT c.id,c.name,c.first_name,c.last_name,c.phone,c.created_at,COUNT(i.id) AS invoice_count,MAX(i.issued_at) AS last_purchase_at
       FROM customer c LEFT JOIN invoice i ON i.customer_id=c.id AND i.status='issued'
       WHERE c.store_id=? AND c.archived_at IS NULL
       GROUP BY c.id ORDER BY last_purchase_at DESC,c.created_at DESC`, [this.storeId]);
    return rows.filter(row => normalizeSearch(`${row.name} ${row.phone ?? ''}`).includes(needle)).map(row => ({ id: row.id, name: row.name, firstName: row.first_name ?? '', lastName: row.last_name ?? '', phone: row.phone ?? '', invoiceCount: row.invoice_count, lastPurchaseAt: row.last_purchase_at, createdAt: row.created_at }));
  }

  async listArchivedCustomers(): Promise<CustomerSummary[]> {
    const rows = await this.db.query<{ id: string; name: string; first_name: string | null; last_name: string | null; phone: string | null; invoice_count: number; last_purchase_at: string | null }>(
      `SELECT c.id,c.name,c.first_name,c.last_name,c.phone,COUNT(i.id) AS invoice_count,MAX(i.issued_at) AS last_purchase_at
       FROM customer c LEFT JOIN invoice i ON i.customer_id=c.id AND i.status='issued'
       WHERE c.store_id=? AND c.archived_at IS NOT NULL GROUP BY c.id ORDER BY c.archived_at DESC`, [this.storeId]);
    return rows.map(row => ({ id: row.id, name: row.name, firstName: row.first_name ?? '', lastName: row.last_name ?? '', phone: row.phone ?? '', invoiceCount: row.invoice_count, lastPurchaseAt: row.last_purchase_at }));
  }

  async setCustomerArchived(customerId: string, archived: boolean): Promise<void> {
    await this.db.transaction(async () => {
      const at = new Date().toISOString();
      const result = await this.db.run(`UPDATE customer SET archived_at=? WHERE id=? AND store_id=? AND ${archived ? 'archived_at IS NULL' : 'archived_at IS NOT NULL'}`,
        [archived ? at : null, customerId, this.storeId]);
      if (result.changes !== 1) throw new Error('مشتری در وضعیت مورد انتظار پیدا نشد.');
      await this.audit('customer', customerId, archived ? 'archive' : 'restore', {}, at);
    });
  }

  async listCustomerInvoices(customerId: string): Promise<InvoiceHistoryEntry[]> {
    const rows = await this.db.query<{ snapshot_json: string; status: 'issued' | 'void' }>(
      `SELECT r.snapshot_json,i.status FROM invoice i JOIN invoice_revision r ON r.invoice_id=i.id AND r.revision_no=i.current_revision
       WHERE i.store_id=? AND i.customer_id=? AND i.status IN ('issued','void') ORDER BY i.invoice_number DESC`, [this.storeId, customerId]);
    const receipts = await this.enrichReceipts(rows.map(row => JSON.parse(row.snapshot_json) as InvoiceReceipt));
    return rows.map((row, index) => ({ receipt: receipts[index], status: row.status }));
  }

  private async enrichReceipts(receipts: InvoiceReceipt[]): Promise<InvoiceReceipt[]> {
    if (!receipts.length) return receipts;
    const ids = [...new Set(receipts.map(receipt => receipt.id))];
    const rows = await this.db.query<{ invoice_id: string; status: PaymentStatus; paid_rial: number; returned_rial: number; refunded_rial: number }>(
      `SELECT invoice_id,status,paid_rial,returned_rial,refunded_rial FROM invoice_finance WHERE invoice_id IN (${ids.map(() => '?').join(',')})`, ids);
    const byId = new Map(rows.map(row => [row.invoice_id, row]));
    return receipts.map(receipt => {
      const finance = byId.get(receipt.id);
      if (!finance) return receipt;
      const paid = finance.paid_rial - finance.refunded_rial;
      const netTotal = receipt.totalRial - finance.returned_rial;
      return { ...receipt, paymentStatus: finance.status, paidRial: paid, returnedRial: finance.returned_rial,
        refundedRial: finance.refunded_rial, balanceRial: Math.max(0, netTotal - paid) };
    });
  }

  async reviseInvoice(invoiceId: string, inputLines: InvoiceInputLine[], customerName: string, customerPhone: string, dateJalali: string, reason: string, details: InvoiceDetails = {}): Promise<InvoiceReceipt> {
    if (!inputLines.length || !reason.trim()) throw new Error('ردیف و دلیل ویرایش فاکتور لازم است.');
    if (dateJalali && !isValidJalaliDate(dateJalali)) throw new Error('تاریخ شمسی نامعتبر است.');
    if (customerPhone && !/^\+?[0-9۰-۹٠-٩\s-]{7,20}$/.test(customerPhone)) throw new Error('شمارهٔ تماس مشتری نامعتبر است.');
    if (details.dueDateJalali && !isValidJalaliDate(details.dueDateJalali)) throw new Error('تاریخ سررسید نامعتبر است.');
    assertRial(details.shippingRial ?? 0); assertRial(details.paidRial ?? 0);
    return this.db.transaction(async () => {
      const rows = await this.db.query<{ current_revision: number; snapshot_json: string; revision_id: string }>(
        `SELECT i.current_revision,r.snapshot_json,r.id AS revision_id FROM invoice i
         JOIN invoice_revision r ON r.invoice_id=i.id AND r.revision_no=i.current_revision
         WHERE i.id=? AND i.store_id=? AND i.status='issued'`, [invoiceId, this.storeId]);
      if (!rows.length) throw new Error('فاکتور صادرشده پیدا نشد.');
      const current = rows[0];
      const previous = JSON.parse(current.snapshot_json) as InvoiceReceipt;
      const financeRows = await this.db.query<{ status: PaymentStatus; paid_rial: number; returned_rial: number; refunded_rial: number }>(
        'SELECT status,paid_rial,returned_rial,refunded_rial FROM invoice_finance WHERE invoice_id=?', [invoiceId]);
      if (!financeRows.length) throw new Error('پروندهٔ مالی فاکتور پیدا نشد.');
      const finance = financeRows[0];
      if (finance.returned_rial > 0) throw new Error('فاکتور دارای مرجوعی را نمی‌توان ویرایش کرد؛ برای اصلاح، سند جدا ثبت کنید.');
      const now = new Date().toISOString();
      const lines: InvoiceReceipt['lines'] = [];
      for (const input of inputLines) {
        if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || !Number.isSafeInteger(input.quantity * 1000)) throw new Error('تعداد کالا نامعتبر است.');
        let name = input.name?.trim() ?? '';
        let model = ''; let color = '';
        let price = input.unitPriceRial;
        if (input.productId) {
          const products = await this.db.query<{ name: string; model: string | null; color: string | null; price_rial: number }>(
            'SELECT name,model,color,price_rial FROM product WHERE id=? AND store_id=?', [input.productId, this.storeId]);
          if (!products.length) throw new Error('کالای ردیف پیدا نشد.');
          name ||= products[0].name;
          model = products[0].model ?? ''; color = products[0].color ?? '';
          price ??= products[0].price_rial;
        }
        if (!name || price === undefined) throw new Error('شرح و قیمت ردیف لازم است.');
        const amounts = invoiceLineAmounts(price, input.quantity, input.discountBasisPoints);
        lines.push({ productId: input.productId, name, model, color, quantity: input.quantity, unitPriceRial: price, discountBasisPoints: input.discountBasisPoints ?? 0, discountRial: amounts.discountRial, totalRial: amounts.totalRial });
      }
      const subtotal = lines.reduce((sum, line) => sum + BigInt(line.unitPriceRial) * BigInt(line.quantity), 0n);
      const discount = lines.reduce((sum, line) => sum + BigInt(line.discountRial ?? 0), 0n);
      const grand = subtotal - discount + BigInt(details.shippingRial ?? previous.shippingRial ?? 0);
      if (subtotal > BigInt(Number.MAX_SAFE_INTEGER) || grand > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('مبلغ فاکتور بیش از حد مجاز است.');
      const paid = finance.paid_rial - finance.refunded_rial;
      if (details.paidRial !== undefined && details.paidRial !== paid) throw new Error('مبلغ دریافتی را در بخش وضعیت پرداخت ثبت یا اصلاح کنید.');
      if (BigInt(paid) > grand) throw new Error('مبلغ پرداختی از مبلغ نهایی بیشتر است.');
      const receipt: InvoiceReceipt = { ...previous, customerName: customerName.trim(), customerPhone: customerPhone.trim(), dateJalali: dateJalali || previous.dateJalali,
        customerAddress: details.customerAddress?.trim() ?? previous.customerAddress, paymentMethod: details.paymentMethod?.trim() ?? previous.paymentMethod,
        dueDateJalali: details.dueDateJalali ?? previous.dueDateJalali, showCardNumber: details.showCardNumber ?? previous.showCardNumber,
        lines, subtotalRial: Number(subtotal), discountRial: Number(discount), shippingRial: details.shippingRial ?? previous.shippingRial ?? 0,
        paidRial: paid, balanceRial: Number(grand) - paid, paymentStatus: finance.status === 'proforma' ? 'proforma' : paid >= Number(grand) ? 'settled' : paid > 0 ? 'partial' : 'unpaid', totalRial: Number(grand), revision: current.current_revision + 1 };
      const revisionId = crypto.randomUUID();
      await this.db.run(`INSERT INTO invoice_revision(id,invoice_id,revision_no,template_version_id,snapshot_json,subtotal_rial,discount_rial,shipping_rial,grand_total_rial,paid_rial,balance_rial,reason,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, [revisionId, invoiceId, receipt.revision!, receipt.templateVersionId ?? null, JSON.stringify(receipt), receipt.subtotalRial!, receipt.discountRial!, receipt.shippingRial!, receipt.totalRial, receipt.paidRial!, receipt.balanceRial!, reason.trim(), now]);
      const oldLines = await this.db.query<{ product_id: string | null; quantity_milli: number }>('SELECT product_id,quantity_milli FROM invoice_line WHERE invoice_revision_id=?', [current.revision_id]);
      const stockDelta = new Map<string, number>();
      if (finance.status !== 'proforma') {
        for (const line of oldLines) if (line.product_id) stockDelta.set(line.product_id, (stockDelta.get(line.product_id) ?? 0) + line.quantity_milli);
        for (const line of lines) if (line.productId) stockDelta.set(line.productId, (stockDelta.get(line.productId) ?? 0) - line.quantity * 1000);
      }
      for (const [productId, delta] of stockDelta) {
        if (!delta) continue;
        const update = delta < 0
          ? await this.db.run('UPDATE stock_balance SET quantity_milli=quantity_milli+? WHERE product_id=? AND quantity_milli>=?', [delta, productId, -delta])
          : await this.db.run('UPDATE stock_balance SET quantity_milli=quantity_milli+? WHERE product_id=? AND quantity_milli<=?', [delta, productId, Number.MAX_SAFE_INTEGER - delta]);
        if (update.changes !== 1) throw new Error('موجودی برای ویرایش فاکتور کافی نیست؛ هیچ تغییری ثبت نشد.');
        await this.db.run('INSERT INTO stock_movement(id,product_id,quantity_milli,reason,invoice_revision_id,created_at) VALUES(?,?,?,?,?,?)',
          [crypto.randomUUID(), productId, delta, 'invoice_revision', revisionId, now]);
      }
      let customerId: string | null = null;
      if (receipt.customerName) {
        const existing = receipt.customerPhone ? await this.db.query<{ id: string }>('SELECT id FROM customer WHERE store_id=? AND phone=? AND archived_at IS NULL LIMIT 1', [this.storeId, receipt.customerPhone]) : [];
        customerId = existing[0]?.id ?? crypto.randomUUID();
        if (!existing.length) await this.db.run('INSERT INTO customer(id,store_id,name,phone,created_at) VALUES(?,?,?,?,?)', [customerId, this.storeId, receipt.customerName, receipt.customerPhone || null, now]);
      }
      for (const line of lines) await this.db.run(`INSERT INTO invoice_line(id,invoice_revision_id,product_id,name_snapshot,color_snapshot,unit_snapshot,quantity_milli,unit_price_rial,discount_rial,line_total_rial)
        VALUES(?,?,?,?,?,?,?,?,?,?)`, [crypto.randomUUID(), revisionId, line.productId ?? null, line.name, line.color ?? null, 'عدد', line.quantity * 1000, line.unitPriceRial, line.discountRial ?? 0, line.totalRial]);
      const changed = await this.db.run('UPDATE invoice SET current_revision=?,customer_id=? WHERE id=? AND store_id=? AND current_revision=? AND status=\'issued\'',
        [receipt.revision!, customerId, invoiceId, this.storeId, current.current_revision]);
      if (changed.changes !== 1) throw new Error('فاکتور هم‌زمان تغییر کرده است.');
      await this.db.run('UPDATE invoice_finance SET status=?,due_jalali=?,updated_at=? WHERE invoice_id=?', [receipt.paymentStatus!, receipt.dueDateJalali || null, now, invoiceId]);
      const difference = receipt.totalRial - previous.totalRial;
      const saleDifference = (receipt.totalRial - (receipt.shippingRial ?? 0)) - (previous.totalRial - (previous.shippingRial ?? 0));
      const shippingDifference = (receipt.shippingRial ?? 0) - (previous.shippingRial ?? 0);
      if (finance.status !== 'proforma' && (saleDifference !== 0 || shippingDifference !== 0)) await this.journal('sale_revision', revisionId, `اصلاح فاکتور ${receipt.number}`, now, [
        { account: 'receivable', debit: Math.max(0, difference), credit: Math.max(0, -difference) },
        { account: 'sales', debit: Math.max(0, -saleDifference), credit: Math.max(0, saleDifference) },
        { account: 'shipping_income', debit: Math.max(0, -shippingDifference), credit: Math.max(0, shippingDifference) }
      ]);
      await this.audit('invoice', invoiceId, 'revise', { revision: receipt.revision, reason: reason.trim(), previousRevision: current.current_revision }, now);
      return receipt;
    });
  }

  async voidInvoice(invoiceId: string, reason: string): Promise<void> {
    if (!reason.trim()) throw new Error('دلیل ابطال لازم است.');
    await this.db.transaction(async () => {
      const rows = await this.db.query<{ revision_id: string; status: string }>(
        `SELECT r.id AS revision_id,i.status FROM invoice i JOIN invoice_revision r ON r.invoice_id=i.id
         WHERE i.id=? AND i.store_id=? AND r.revision_no=i.current_revision`, [invoiceId, this.storeId]);
      if (!rows.length || rows[0].status !== 'issued') throw new Error('فاکتور صادرشدهٔ فعال پیدا نشد.');
      const revisionId = rows[0].revision_id;
      const financeRows = await this.db.query<{ status: PaymentStatus; paid_rial: number; returned_rial: number; refunded_rial: number }>(
        'SELECT status,paid_rial,returned_rial,refunded_rial FROM invoice_finance WHERE invoice_id=?', [invoiceId]);
      const finance = financeRows[0];
      if (!finance) throw new Error('پروندهٔ مالی فاکتور پیدا نشد.');
      if (finance.paid_rial !== finance.refunded_rial || finance.returned_rial > 0) throw new Error('فاکتور دارای دریافت یا مرجوعی است؛ ابتدا تسویه و ثبت اصلاح مالی انجام شود.');
      const revision = await this.db.query<{ grand_total_rial: number; shipping_rial: number }>('SELECT grand_total_rial,shipping_rial FROM invoice_revision WHERE id=?', [revisionId]);
      const lines = await this.db.query<{ product_id: string | null; quantity_milli: number }>(
        'SELECT product_id,quantity_milli FROM invoice_line WHERE invoice_revision_id=?', [revisionId]);
      const at = new Date().toISOString();
      for (const line of lines) {
        if (finance.status === 'proforma') continue;
        if (!line.product_id) continue;
        const balance = await this.db.run(
          'UPDATE stock_balance SET quantity_milli=quantity_milli+? WHERE product_id=? AND quantity_milli<=?',
          [line.quantity_milli, line.product_id, Number.MAX_SAFE_INTEGER - line.quantity_milli]);
        if (balance.changes !== 1) throw new Error('بازگردانی موجودی ممکن نشد؛ ابطال لغو شد.');
        await this.db.run('INSERT INTO stock_movement(id,product_id,quantity_milli,reason,invoice_revision_id,created_at) VALUES(?,?,?,?,?,?)',
          [crypto.randomUUID(), line.product_id, line.quantity_milli, 'void', revisionId, at]);
      }
      const updated = await this.db.run("UPDATE invoice SET status='void' WHERE id=? AND store_id=? AND status='issued'", [invoiceId, this.storeId]);
      if (updated.changes !== 1) throw new Error('وضعیت فاکتور هم‌زمان تغییر کرده است.');
      if (finance.status !== 'proforma' && revision[0]?.grand_total_rial > 0) await this.journal('void', invoiceId, `ابطال فاکتور: ${reason.trim()}`, at, [
        { account: 'sales', debit: revision[0].grand_total_rial - revision[0].shipping_rial },
        { account: 'shipping_income', debit: revision[0].shipping_rial },
        { account: 'receivable', credit: revision[0].grand_total_rial }
      ]);
      await this.audit('invoice', invoiceId, 'void', { reason: reason.trim(), revisionId }, at);
    });
  }

  async recordInvoicePayment(invoiceId: string, amountRial: number, method: string, requestId = crypto.randomUUID()): Promise<InvoiceReceipt> {
    assertRial(amountRial);
    if (amountRial <= 0 || !method.trim()) throw new Error('مبلغ مثبت و روش دریافت لازم است.');
    return this.db.transaction(async () => {
      const rows = await this.db.query<{ snapshot_json: string; status: PaymentStatus; paid_rial: number; returned_rial: number; refunded_rial: number }>(
        `SELECT r.snapshot_json,f.status,f.paid_rial,f.returned_rial,f.refunded_rial FROM invoice i
         JOIN invoice_revision r ON r.invoice_id=i.id AND r.revision_no=i.current_revision JOIN invoice_finance f ON f.invoice_id=i.id
         WHERE i.id=? AND i.store_id=? AND i.status='issued'`, [invoiceId, this.storeId]);
      if (!rows.length) throw new Error('فاکتور فعال پیدا نشد.');
      const row = rows[0];
      if (row.status === 'proforma') throw new Error('پیش‌فاکتور ابتدا باید به فروش قطعی تبدیل شود.');
      const receipt = JSON.parse(row.snapshot_json) as InvoiceReceipt;
      const remaining = receipt.totalRial - row.returned_rial - row.paid_rial + row.refunded_rial;
      if (amountRial > remaining) throw new Error('دریافت از ماندهٔ واقعی فاکتور بیشتر است.');
      const at = new Date().toISOString();
      const inserted = await this.db.run('INSERT OR IGNORE INTO invoice_payment_event(id,invoice_id,amount_rial,direction,method,created_at) VALUES(?,?,?,?,?,?)',
        [requestId, invoiceId, amountRial, 'receive', method.trim(), at]);
      if (inserted.changes !== 1) throw new Error('این دریافت قبلاً ثبت شده است.');
      const nextPaid = row.paid_rial + amountRial;
      const nextStatus: PaymentStatus = nextPaid - row.refunded_rial === receipt.totalRial - row.returned_rial ? 'settled' : 'partial';
      await this.db.run('UPDATE invoice_finance SET paid_rial=?,status=?,updated_at=? WHERE invoice_id=?', [nextPaid, nextStatus, at, invoiceId]);
      await this.journal('receipt', requestId, `دریافت فاکتور ${receipt.number}`, at, [
        { account: 'cash_bank', debit: amountRial }, { account: 'receivable', credit: amountRial }
      ]);
      await this.audit('invoice', invoiceId, 'receive', { amountRial, method: method.trim(), requestId }, at);
      return (await this.enrichReceipts([receipt]))[0];
    });
  }

  async refundInvoicePayment(invoiceId: string, amountRial: number, method: string, requestId = crypto.randomUUID()): Promise<InvoiceReceipt> {
    assertRial(amountRial);
    if (amountRial <= 0 || !method.trim()) throw new Error('مبلغ مثبت و روش بازپرداخت لازم است.');
    return this.db.transaction(async () => {
      const rows = await this.db.query<{ snapshot_json: string; paid_rial: number; returned_rial: number; refunded_rial: number }>(
        `SELECT r.snapshot_json,f.paid_rial,f.returned_rial,f.refunded_rial FROM invoice i
         JOIN invoice_revision r ON r.invoice_id=i.id AND r.revision_no=i.current_revision JOIN invoice_finance f ON f.invoice_id=i.id
         WHERE i.id=? AND i.store_id=? AND i.status='issued'`, [invoiceId, this.storeId]);
      if (!rows.length) throw new Error('فاکتور فعال پیدا نشد.');
      const row = rows[0]; const receipt = JSON.parse(row.snapshot_json) as InvoiceReceipt;
      const refundDue = row.paid_rial - row.refunded_rial - (receipt.totalRial - row.returned_rial);
      if (amountRial > refundDue) throw new Error('بازپرداخت از طلب مشتری بیشتر است.');
      const at = new Date().toISOString();
      const inserted = await this.db.run('INSERT OR IGNORE INTO invoice_payment_event(id,invoice_id,amount_rial,direction,method,created_at) VALUES(?,?,?,?,?,?)',
        [requestId, invoiceId, amountRial, 'refund', method.trim(), at]);
      if (inserted.changes !== 1) throw new Error('این بازپرداخت قبلاً ثبت شده است.');
      const refunded = row.refunded_rial + amountRial;
      const netPaid = row.paid_rial - refunded;
      const netTotal = receipt.totalRial - row.returned_rial;
      const status: PaymentStatus = netPaid === netTotal ? 'settled' : netPaid > 0 ? 'partial' : 'unpaid';
      await this.db.run('UPDATE invoice_finance SET refunded_rial=?,status=?,updated_at=? WHERE invoice_id=?', [refunded, status, at, invoiceId]);
      await this.journal('refund', requestId, `بازپرداخت فاکتور ${receipt.number}`, at, [
        { account: 'refund_payable', debit: amountRial }, { account: 'cash_bank', credit: amountRial }
      ]);
      await this.audit('invoice', invoiceId, 'refund', { amountRial, method: method.trim(), requestId }, at);
      return (await this.enrichReceipts([receipt]))[0];
    });
  }

  async convertProforma(invoiceId: string): Promise<InvoiceReceipt> {
    return this.db.transaction(async () => {
      const rows = await this.db.query<{ snapshot_json: string; revision_id: string; status: PaymentStatus }>(
        `SELECT r.snapshot_json,r.id AS revision_id,f.status FROM invoice i JOIN invoice_revision r ON r.invoice_id=i.id AND r.revision_no=i.current_revision
         JOIN invoice_finance f ON f.invoice_id=i.id WHERE i.id=? AND i.store_id=? AND i.status='issued'`, [invoiceId, this.storeId]);
      if (!rows.length || rows[0].status !== 'proforma') throw new Error('پیش‌فاکتور فعال پیدا نشد.');
      const receipt = JSON.parse(rows[0].snapshot_json) as InvoiceReceipt;
      const at = new Date().toISOString();
      for (const line of receipt.lines) {
        if (!line.productId) continue;
        const quantity = line.quantity * 1000;
        const updated = await this.db.run('UPDATE stock_balance SET quantity_milli=quantity_milli-? WHERE product_id=? AND quantity_milli>=?', [quantity, line.productId, quantity]);
        if (updated.changes !== 1) throw new Error(`موجودی «${line.name}» برای تبدیل پیش‌فاکتور کافی نیست.`);
        await this.db.run('INSERT INTO stock_movement(id,product_id,quantity_milli,reason,invoice_revision_id,created_at) VALUES(?,?,?,?,?,?)',
          [crypto.randomUUID(), line.productId, -quantity, 'proforma_conversion', rows[0].revision_id, at]);
      }
      const status: PaymentStatus = receipt.totalRial === 0 ? 'settled' : 'unpaid';
      await this.db.run('UPDATE invoice_finance SET status=?,updated_at=? WHERE invoice_id=? AND status=?', [status, at, invoiceId, 'proforma']);
      if (receipt.totalRial > 0) await this.journal('sale', invoiceId, `تبدیل پیش‌فاکتور ${receipt.number} به فروش`, at, [
        { account: 'receivable', debit: receipt.totalRial }, { account: 'sales', credit: receipt.totalRial - (receipt.shippingRial ?? 0) },
        { account: 'shipping_income', credit: receipt.shippingRial ?? 0 }
      ]);
      await this.audit('invoice', invoiceId, 'convert_proforma', {}, at);
      return (await this.enrichReceipts([receipt]))[0];
    });
  }

  async returnInvoice(invoiceId: string, selected: ReturnLineInput[], reason: string, includeShipping = false): Promise<{ receipt: InvoiceReceipt; returnedRial: number }> {
    if (!reason.trim() || !selected.length || new Set(selected.map(line => line.index)).size !== selected.length) throw new Error('ردیف‌های مرجوعی و دلیل معتبر لازم است.');
    return this.db.transaction(async () => {
      const rows = await this.db.query<{ snapshot_json: string; revision_id: string; status: PaymentStatus; returned_rial: number; shipping_returned_rial: number; paid_rial: number; refunded_rial: number }>(
        `SELECT r.snapshot_json,r.id AS revision_id,f.status,f.returned_rial,f.shipping_returned_rial,f.paid_rial,f.refunded_rial
         FROM invoice i JOIN invoice_revision r ON r.invoice_id=i.id AND r.revision_no=i.current_revision JOIN invoice_finance f ON f.invoice_id=i.id
         WHERE i.id=? AND i.store_id=? AND i.status='issued'`, [invoiceId, this.storeId]);
      if (!rows.length || rows[0].status === 'proforma') throw new Error('مرجوعی فقط برای فروش قطعی ممکن است.');
      const row = rows[0]; const receipt = JSON.parse(row.snapshot_json) as InvoiceReceipt;
      const prior = await this.db.query<{ line_index: number; quantity: number; amount: number }>(
        `SELECT l.line_index,SUM(l.quantity_milli) AS quantity,SUM(l.amount_rial) AS amount FROM sales_return_line l
         JOIN sales_return s ON s.id=l.return_id WHERE s.invoice_id=? AND s.invoice_revision_id=? GROUP BY l.line_index`, [invoiceId, row.revision_id]);
      const priorByIndex = new Map(prior.map(item => [item.line_index, item]));
      const returns: { index: number; productId?: string; name: string; quantityMilli: number; amount: number; restock: boolean }[] = [];
      for (const item of selected) {
        const line = receipt.lines[item.index];
        if (!line || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new Error('تعداد مرجوعی نامعتبر است.');
        const already = priorByIndex.get(item.index);
        const remainingMilli = line.quantity * 1000 - (already?.quantity ?? 0);
        const quantityMilli = item.quantity * 1000;
        if (!Number.isSafeInteger(quantityMilli) || quantityMilli > remainingMilli) throw new Error(`تعداد مرجوعی «${line.name}» از مقدار قابل مرجوع بیشتر است.`);
        const amount = quantityMilli === remainingMilli ? line.totalRial - (already?.amount ?? 0)
          : Number((BigInt(line.totalRial) * BigInt(quantityMilli) + BigInt(line.quantity * 500)) / BigInt(line.quantity * 1000));
        returns.push({ index: item.index, productId: line.productId, name: line.name, quantityMilli, amount, restock: item.restock });
      }
      const shippingReturn = includeShipping ? (receipt.shippingRial ?? 0) - row.shipping_returned_rial : 0;
      const lineAmount = returns.reduce((sum, item) => sum + item.amount, 0);
      const returnedRial = lineAmount + shippingReturn;
      if (!returnedRial || row.returned_rial + returnedRial > receipt.totalRial) throw new Error('مبلغ مرجوعی معتبر نیست.');
      const id = crypto.randomUUID(); const at = new Date().toISOString();
      await this.db.run('INSERT INTO sales_return(id,invoice_id,invoice_revision_id,amount_rial,reason,created_at) VALUES(?,?,?,?,?,?)',
        [id, invoiceId, row.revision_id, returnedRial, reason.trim(), at]);
      for (const item of returns) {
        await this.db.run('INSERT INTO sales_return_line(id,return_id,line_index,product_id,name_snapshot,quantity_milli,amount_rial,restocked) VALUES(?,?,?,?,?,?,?,?)',
          [crypto.randomUUID(), id, item.index, item.productId ?? null, item.name, item.quantityMilli, item.amount, item.restock ? 1 : 0]);
        if (item.restock && item.productId) {
          const changed = await this.db.run('UPDATE stock_balance SET quantity_milli=quantity_milli+? WHERE product_id=? AND quantity_milli<=?',
            [item.quantityMilli, item.productId, Number.MAX_SAFE_INTEGER - item.quantityMilli]);
          if (changed.changes !== 1) throw new Error('بازگردانی موجودی ممکن نشد.');
          await this.db.run('INSERT INTO stock_movement(id,product_id,quantity_milli,reason,invoice_revision_id,created_at) VALUES(?,?,?,?,?,?)',
            [crypto.randomUUID(), item.productId, item.quantityMilli, 'sales_return', row.revision_id, at]);
        }
      }
      const netTotal = receipt.totalRial - row.returned_rial - returnedRial;
      const netPaid = row.paid_rial - row.refunded_rial;
      const status: PaymentStatus = netPaid >= netTotal ? 'settled' : netPaid > 0 ? 'partial' : 'unpaid';
      await this.db.run('UPDATE invoice_finance SET returned_rial=?,shipping_returned_rial=?,status=?,updated_at=? WHERE invoice_id=?',
        [row.returned_rial + returnedRial, row.shipping_returned_rial + shippingReturn, status, at, invoiceId]);
      const oldReceivable = Math.max(0, receipt.totalRial - row.returned_rial - netPaid);
      const receivableCredit = Math.min(returnedRial, oldReceivable);
      await this.journal('sales_return', id, `مرجوعی فاکتور ${receipt.number}`, at, [
        { account: 'sales_returns', debit: lineAmount }, { account: 'shipping_income', debit: shippingReturn },
        { account: 'receivable', credit: receivableCredit }, { account: 'refund_payable', credit: returnedRial - receivableCredit }
      ]);
      await this.audit('invoice', invoiceId, 'sales_return', { returnId: id, returnedRial, reason: reason.trim() }, at);
      return { receipt: (await this.enrichReceipts([receipt]))[0], returnedRial };
    });
  }

  async listSalesReturns(): Promise<{ id: string; invoiceId: string; invoiceNumber: number; customer: string; amountRial: number; reason: string; at: string }[]> {
    const rows = await this.db.query<{ id: string; invoice_id: string; invoice_number: number; snapshot_json: string; amount_rial: number; reason: string; created_at: string }>(
      `SELECT s.id,s.invoice_id,i.invoice_number,r.snapshot_json,s.amount_rial,s.reason,s.created_at FROM sales_return s
       JOIN invoice i ON i.id=s.invoice_id JOIN invoice_revision r ON r.id=s.invoice_revision_id WHERE i.store_id=? ORDER BY s.created_at DESC`, [this.storeId]);
    return rows.map(row => ({ id: row.id, invoiceId: row.invoice_id, invoiceNumber: row.invoice_number,
      customer: (JSON.parse(row.snapshot_json) as InvoiceReceipt).customerName, amountRial: row.amount_rial, reason: row.reason, at: row.created_at }));
  }

  async listReturnableLines(invoiceId: string): Promise<{ index: number; name: string; sold: number; returned: number; available: number }[]> {
    const rows = await this.db.query<{ snapshot_json: string; revision_id: string }>(
      `SELECT r.snapshot_json,r.id AS revision_id FROM invoice i JOIN invoice_revision r ON r.invoice_id=i.id AND r.revision_no=i.current_revision
       WHERE i.id=? AND i.store_id=? AND i.status='issued'`, [invoiceId, this.storeId]);
    if (!rows.length) throw new Error('فاکتور پیدا نشد.');
    const receipt = JSON.parse(rows[0].snapshot_json) as InvoiceReceipt;
    const prior = await this.db.query<{ line_index: number; quantity: number }>(
      `SELECT l.line_index,SUM(l.quantity_milli) AS quantity FROM sales_return_line l JOIN sales_return s ON s.id=l.return_id
       WHERE s.invoice_id=? AND s.invoice_revision_id=? GROUP BY l.line_index`, [invoiceId, rows[0].revision_id]);
    const byIndex = new Map(prior.map(item => [item.line_index, item.quantity / 1000]));
    return receipt.lines.map((line, index) => ({ index, name: line.name, sold: line.quantity,
      returned: byIndex.get(index) ?? 0, available: line.quantity - (byIndex.get(index) ?? 0) }));
  }

  async createPurchase(supplier: string, lines: { productId: string; quantity: number; unitCostRial: number }[], paidRial: number, dueJalali = '', note = ''): Promise<string> {
    if (!supplier.trim() || !lines.length) throw new Error('نام تأمین‌کننده و دست‌کم یک کالا لازم است.');
    if (dueJalali && !isValidJalaliDate(dueJalali)) throw new Error('تاریخ سررسید نامعتبر است.');
    assertRial(paidRial);
    let total = 0n;
    for (const line of lines) {
      if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0 || !Number.isSafeInteger(line.quantity * 1000)) throw new Error('تعداد خرید نامعتبر است.');
      assertRial(line.unitCostRial);
      total += BigInt(line.quantity) * BigInt(line.unitCostRial);
    }
    if (total > BigInt(Number.MAX_SAFE_INTEGER) || BigInt(paidRial) > total) throw new Error('مبلغ خرید یا پرداخت نامعتبر است.');
    if (paidRial < Number(total) && !dueJalali) throw new Error('برای بدهی خرید، تاریخ سررسید وارد کنید.');
    return this.db.transaction(async () => {
      const id = crypto.randomUUID(); const at = new Date().toISOString();
      await this.db.run('INSERT INTO purchase_entry(id,supplier,total_rial,paid_rial,due_jalali,note,created_at) VALUES(?,?,?,?,?,?,?)',
        [id, supplier.trim(), Number(total), paidRial, dueJalali || null, note.trim() || null, at]);
      for (const line of lines) {
        const product = await this.db.query<{ id: string }>('SELECT id FROM product WHERE id=? AND store_id=? AND archived_at IS NULL', [line.productId, this.storeId]);
        if (!product.length) throw new Error('کالای خرید در فهرست فعال پیدا نشد.');
        const quantityMilli = line.quantity * 1000;
        await this.db.run('INSERT INTO purchase_line(id,purchase_id,product_id,quantity_milli,unit_cost_rial,line_total_rial) VALUES(?,?,?,?,?,?)',
          [crypto.randomUUID(), id, line.productId, quantityMilli, line.unitCostRial, line.quantity * line.unitCostRial]);
        const stock = await this.db.run('UPDATE stock_balance SET quantity_milli=quantity_milli+? WHERE product_id=? AND quantity_milli<=?',
          [quantityMilli, line.productId, Number.MAX_SAFE_INTEGER - quantityMilli]);
        if (stock.changes !== 1) throw new Error('افزودن موجودی خرید ممکن نشد.');
        await this.db.run('INSERT INTO stock_movement(id,product_id,quantity_milli,reason,created_at) VALUES(?,?,?,?,?)',
          [crypto.randomUUID(), line.productId, quantityMilli, 'purchase', at]);
      }
      if (total > 0n) await this.journal('purchase', id, `خرید از ${supplier.trim()}`, at, [
        { account: 'inventory', debit: Number(total) }, { account: 'payable', credit: Number(total) }
      ]);
      if (paidRial) await this.journal('purchase_payment', id, `پرداخت خرید ${supplier.trim()}`, at, [
        { account: 'payable', debit: paidRial }, { account: 'cash_bank', credit: paidRial }
      ]);
      await this.audit('purchase', id, 'create', { supplier: supplier.trim(), totalRial: Number(total), paidRial }, at);
      return id;
    });
  }

  async createExpense(category: string, description: string, amountRial: number, settled: boolean, dueJalali = ''): Promise<string> {
    assertRial(amountRial);
    if (!category.trim() || !description.trim() || amountRial <= 0) throw new Error('دسته، شرح و مبلغ هزینه لازم است.');
    if (!settled && (!dueJalali || !isValidJalaliDate(dueJalali))) throw new Error('برای هزینهٔ پرداخت‌نشده تاریخ سررسید لازم است.');
    return this.db.transaction(async () => {
      const id = crypto.randomUUID(); const at = new Date().toISOString();
      await this.db.run('INSERT INTO expense_entry(id,category,description,amount_rial,settled,due_jalali,created_at) VALUES(?,?,?,?,?,?,?)',
        [id, category.trim(), description.trim(), amountRial, settled ? 1 : 0, dueJalali || null, at]);
      await this.journal('expense', id, description.trim(), at, [
        { account: `expense:${category.trim()}`, debit: amountRial }, { account: settled ? 'cash_bank' : 'payable', credit: amountRial }
      ]);
      await this.audit('expense', id, 'create', { amountRial, settled }, at);
      return id;
    });
  }

  async recordPurchasePayment(purchaseId: string, amountRial: number, method: string, requestId = crypto.randomUUID()): Promise<void> {
    assertRial(amountRial);
    if (amountRial <= 0 || !method.trim()) throw new Error('مبلغ و روش پرداخت لازم است.');
    await this.db.transaction(async () => {
      const rows = await this.db.query<{ total_rial: number; paid_rial: number; supplier: string }>('SELECT total_rial,paid_rial,supplier FROM purchase_entry WHERE id=?', [purchaseId]);
      if (!rows.length || amountRial > rows[0].total_rial - rows[0].paid_rial) throw new Error('پرداخت از ماندهٔ خرید بیشتر است.');
      const at = new Date().toISOString();
      const inserted = await this.db.run('INSERT OR IGNORE INTO purchase_payment_event(id,purchase_id,amount_rial,method,created_at) VALUES(?,?,?,?,?)',
        [requestId, purchaseId, amountRial, method.trim(), at]);
      if (inserted.changes !== 1) throw new Error('این پرداخت قبلاً ثبت شده است.');
      await this.db.run('UPDATE purchase_entry SET paid_rial=paid_rial+? WHERE id=?', [amountRial, purchaseId]);
      await this.journal('purchase_payment', requestId, `پرداخت خرید ${rows[0].supplier}`, at, [
        { account: 'payable', debit: amountRial }, { account: 'cash_bank', credit: amountRial }
      ]);
      await this.audit('purchase', purchaseId, 'payment', { amountRial, method: method.trim() }, at);
    });
  }

  async settleExpense(id: string): Promise<void> {
    await this.db.transaction(async () => {
      const rows = await this.db.query<{ amount_rial: number; description: string }>('SELECT amount_rial,description FROM expense_entry WHERE id=? AND settled=0', [id]);
      if (!rows.length) throw new Error('هزینهٔ باز پیدا نشد.');
      const at = new Date().toISOString();
      await this.db.run('UPDATE expense_entry SET settled=1 WHERE id=? AND settled=0', [id]);
      await this.journal('expense_payment', id, rows[0].description, at, [
        { account: 'payable', debit: rows[0].amount_rial }, { account: 'cash_bank', credit: rows[0].amount_rial }
      ]);
      await this.audit('expense', id, 'settle', {}, at);
    });
  }

  async createCheque(input: Omit<ChequeEntry, 'id' | 'status' | 'createdAt'>): Promise<string> {
    assertRial(input.amountRial);
    if (!['received', 'issued'].includes(input.direction) || !input.party.trim() || !input.serial.trim() || input.amountRial <= 0 || !isValidJalaliDate(input.dueJalali))
      throw new Error('مشخصات و سررسید چک نامعتبر است.');
    return this.db.transaction(async () => {
      const id = crypto.randomUUID(); const at = new Date().toISOString();
      await this.db.run('INSERT INTO cheque_entry(id,direction,party,serial,bank,amount_rial,due_jalali,status,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        [id, input.direction, input.party.trim(), input.serial.trim(), input.bank.trim() || null, input.amountRial, input.dueJalali, 'open', input.note.trim() || null, at, at]);
      await this.audit('cheque', id, 'create', { direction: input.direction, amountRial: input.amountRial }, at);
      return id;
    });
  }

  async setChequeStatus(id: string, status: ChequeEntry['status']): Promise<void> {
    if (!['cleared', 'returned', 'cancelled'].includes(status)) throw new Error('وضعیت چک نامعتبر است.');
    await this.db.transaction(async () => {
      const at = new Date().toISOString();
      const changed = await this.db.run('UPDATE cheque_entry SET status=?,updated_at=? WHERE id=? AND status=?', [status, at, id, 'open']);
      if (changed.changes !== 1) throw new Error('چک باز پیدا نشد یا قبلاً تعیین‌تکلیف شده است.');
      await this.audit('cheque', id, status, {}, at);
    });
  }

  async listFinanceOverview(): Promise<FinanceOverview> {
    const [active, archived, purchases, expenses, cheques] = await Promise.all([
      this.listInvoiceHistory(), this.listArchivedInvoices(),
      this.db.query<{ id: string; supplier: string; total_rial: number; paid_rial: number; due_jalali: string | null; note: string | null; created_at: string }>('SELECT * FROM purchase_entry ORDER BY created_at DESC'),
      this.db.query<{ id: string; category: string; description: string; amount_rial: number; settled: number; due_jalali: string | null; created_at: string }>('SELECT * FROM expense_entry ORDER BY created_at DESC'),
      this.db.query<{ id: string; direction: 'received' | 'issued'; party: string; serial: string; bank: string | null; amount_rial: number; due_jalali: string; status: ChequeEntry['status']; note: string | null; created_at: string }>('SELECT * FROM cheque_entry ORDER BY due_jalali ASC')
    ]);
    return {
      invoices: [...active, ...archived].filter(entry => entry.status === 'issued').map(entry => entry.receipt),
      purchases: purchases.map(item => ({ id: item.id, supplier: item.supplier, totalRial: item.total_rial, paidRial: item.paid_rial, dueJalali: item.due_jalali ?? '', note: item.note ?? '', createdAt: item.created_at })),
      expenses: expenses.map(item => ({ id: item.id, category: item.category, description: item.description, amountRial: item.amount_rial, settled: !!item.settled, dueJalali: item.due_jalali ?? '', createdAt: item.created_at })),
      cheques: cheques.map(item => ({ id: item.id, direction: item.direction, party: item.party, serial: item.serial, bank: item.bank ?? '', amountRial: item.amount_rial, dueJalali: item.due_jalali, status: item.status, note: item.note ?? '', createdAt: item.created_at }))
    };
  }

  async purgeArchived(kind: 'invoice' | 'customer' | 'product', ids: string[]): Promise<{ deleted: number; imagePaths: string[] }> {
    const unique = [...new Set(ids)];
    if (!unique.length) return { deleted: 0, imagePaths: [] };
    return this.db.transaction(async () => {
      const photos: string[] = [];
      for (const id of unique) {
        if (kind === 'invoice') {
          const found = await this.db.query<{ id: string }>('SELECT id FROM invoice WHERE id=? AND store_id=? AND archived_at IS NOT NULL', [id, this.storeId]);
          if (!found.length) throw new Error('یکی از فاکتورهای انتخاب‌شده در بایگانی نیست.');
          await this.db.run('DELETE FROM sales_return_line WHERE return_id IN (SELECT id FROM sales_return WHERE invoice_id=?)', [id]);
          await this.db.run('DELETE FROM sales_return WHERE invoice_id=?', [id]);
          await this.db.run('DELETE FROM invoice_payment_event WHERE invoice_id=?', [id]);
          await this.db.run('DELETE FROM payment WHERE invoice_revision_id IN (SELECT id FROM invoice_revision WHERE invoice_id=?)', [id]);
          await this.db.run('DELETE FROM stock_movement WHERE invoice_revision_id IN (SELECT id FROM invoice_revision WHERE invoice_id=?)', [id]);
          await this.db.run('DELETE FROM invoice_line WHERE invoice_revision_id IN (SELECT id FROM invoice_revision WHERE invoice_id=?)', [id]);
          await this.db.run('DELETE FROM invoice_revision WHERE invoice_id=?', [id]);
          await this.db.run('DELETE FROM invoice_finance WHERE invoice_id=?', [id]);
          await this.db.run('DELETE FROM invoice WHERE id=?', [id]);
        } else if (kind === 'customer') {
          const found = await this.db.query<{ id: string }>('SELECT id FROM customer WHERE id=? AND store_id=? AND archived_at IS NOT NULL', [id, this.storeId]);
          if (!found.length) throw new Error('یکی از مشتریان انتخاب‌شده در بایگانی نیست.');
          await this.db.run('UPDATE invoice SET customer_id=NULL WHERE customer_id=?', [id]);
          await this.db.run('DELETE FROM customer WHERE id=?', [id]);
        } else {
          const found = await this.db.query<{ image_path: string | null }>('SELECT image_path FROM product WHERE id=? AND store_id=? AND archived_at IS NOT NULL', [id, this.storeId]);
          if (!found.length) throw new Error('یکی از کالاهای انتخاب‌شده در بایگانی نیست.');
          if (found[0].image_path) photos.push(found[0].image_path);
          await this.db.run('UPDATE invoice_line SET product_id=NULL WHERE product_id=?', [id]);
          await this.db.run('UPDATE sales_return_line SET product_id=NULL WHERE product_id=?', [id]);
          await this.db.run('UPDATE purchase_line SET product_id=NULL WHERE product_id=?', [id]);
          await this.db.run('DELETE FROM price_event WHERE product_id=?', [id]);
          await this.db.run('DELETE FROM stock_movement WHERE product_id=?', [id]);
          await this.db.run('DELETE FROM stock_balance WHERE product_id=?', [id]);
          await this.db.run('DELETE FROM product WHERE id=?', [id]);
        }
        await this.db.run('DELETE FROM audit_event WHERE entity_type=? AND entity_id=?', [kind, id]);
      }
      if (kind === 'product') await this.db.run('DELETE FROM category WHERE store_id=? AND id NOT IN (SELECT category_id FROM product WHERE category_id IS NOT NULL)', [this.storeId]);
      return { deleted: unique.length, imagePaths: photos };
    });
  }

  async compactDatabase(): Promise<void> {
    await this.db.execute('VACUUM');
  }

  private async journal(sourceType: string, sourceId: string, note: string, at: string,
    lines: { account: string; debit?: number; credit?: number }[]): Promise<void> {
    const active = lines.filter(line => (line.debit ?? 0) > 0 || (line.credit ?? 0) > 0);
    if (!active.length) return;
    let debit = 0n; let credit = 0n;
    for (const line of active) {
      const dr = line.debit ?? 0; const cr = line.credit ?? 0;
      assertRial(dr); assertRial(cr);
      if (!line.account || (dr > 0) === (cr > 0)) throw new Error('سطر سند حسابداری نامعتبر است.');
      debit += BigInt(dr); credit += BigInt(cr);
    }
    if (debit !== credit || debit > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('سند حسابداری تراز نیست.');
    const id = crypto.randomUUID();
    await this.db.run('INSERT INTO finance_journal(id,source_type,source_id,note,created_at) VALUES(?,?,?,?,?)', [id, sourceType, sourceId, note, at]);
    for (const line of active) await this.db.run('INSERT INTO finance_journal_line(id,journal_id,account,debit_rial,credit_rial) VALUES(?,?,?,?,?)',
      [crypto.randomUUID(), id, line.account, line.debit ?? 0, line.credit ?? 0]);
  }

  private async audit(type: string, id: string, action: string, payload: object, at: string): Promise<void> {
    await this.db.run('INSERT INTO audit_event(id,store_id,entity_type,entity_id,action,payload_json,actor,created_at) VALUES(?,?,?,?,?,?,?,?)', [crypto.randomUUID(), this.storeId, type, id, action, JSON.stringify(payload), 'owner', at]);
  }
}
