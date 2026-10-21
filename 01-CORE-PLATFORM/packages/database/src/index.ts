import { assertRial, changedPrice, type PriceBatch, type PriceEvent, type Product } from '@majora/domain';

export type SqlValue = string | number | null;
export interface SqlPort {
  execute(sql: string): Promise<void>;
  run(sql: string, values?: SqlValue[]): Promise<{ changes: number }>;
  query<T>(sql: string, values?: SqlValue[]): Promise<T[]>;
  transaction<T>(work: () => Promise<T>): Promise<T>;
}
type ProductRow = { id: string; name: string; category: string | null; price_rial: number; quantity_milli: number; archived_at: string | null };
type EventRow = { id: string; batch_id: string; product_id: string; old_price_rial: number; new_price_rial: number; created_at: string; reason: string };
type BatchRow = { id: string; percent_basis_points: number; created_at: string; scope: string; source_batch_id: string | null; product_ids: string | null; undone_at: string | null };
export type InvoiceInputLine = { productId?: string; name?: string; unitPriceRial?: number; quantity: number };
export type InvoiceReceipt = { id: string; number: number; at: string; customerName: string; lines: { productId?: string; name: string; quantity: number; unitPriceRial: number; totalRial: number }[]; totalRial: number; templateVersionId?: string; templateFields?: Record<string, string> };

export function normalizeSearch(input: string): string {
  return input.normalize('NFKC').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[\u200c\s]+/g, ' ').trim().toLocaleLowerCase('fa-IR');
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
    const rows = await this.db.query<ProductRow>(`SELECT p.id,p.name,COALESCE(c.name,'بدون دسته') AS category,p.price_rial,
      COALESCE(s.quantity_milli,0) AS quantity_milli,p.archived_at FROM product p
      LEFT JOIN category c ON c.id=p.category_id LEFT JOIN stock_balance s ON s.product_id=p.id
      WHERE p.store_id=? AND p.archived_at IS NULL AND p.search_name LIKE ? ORDER BY p.updated_at DESC`, [this.storeId, `%${normalized}%`]);
    return rows.map(r => ({ id: r.id, name: r.name, category: r.category ?? 'بدون دسته', priceRial: r.price_rial, stock: r.quantity_milli / 1000 }));
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
      await this.db.run(`INSERT INTO product(id,store_id,category_id,name,search_name,price_rial,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?)`, [input.id, this.storeId, categoryId, input.name.trim(), normalizeSearch(input.name), input.priceRial, now, now]);
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
        `UPDATE product SET name=?,search_name=?,category_id=?,price_rial=?,updated_at=?,revision=revision+1
         WHERE id=? AND store_id=? AND revision=? AND archived_at IS NULL`,
        [name, normalizeSearch(name), categoryId, input.priceRial, at, input.id, this.storeId, current.revision]
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
  async issueInvoice(requestId: string, customerName: string, inputLines: InvoiceInputLine[]): Promise<InvoiceReceipt> {
    if (!requestId || !inputLines.length) throw new Error('فاکتور باید شناسه و دست‌کم یک ردیف داشته باشد.');
    if (inputLines.some(line => !Number.isSafeInteger(line.quantity) || line.quantity <= 0 || !Number.isSafeInteger(line.quantity * 1000))) throw new Error('تعداد کالا نامعتبر است.');
    return this.db.transaction(async () => {
      const previous = await this.db.query<{ snapshot_json: string }>(`SELECT r.snapshot_json FROM invoice i JOIN invoice_revision r ON r.invoice_id=i.id
        WHERE i.id=? AND i.store_id=? AND i.status='issued' AND r.revision_no=1`, [requestId, this.storeId]);
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
        if (input.productId) {
          const products = await this.db.query<{ name: string; price_rial: number }>('SELECT name,price_rial FROM product WHERE id=? AND store_id=? AND archived_at IS NULL', [input.productId, this.storeId]);
          if (!products.length) throw new Error('کالای انتخابی پیدا نشد.');
          name = products[0].name;
          price = input.unitPriceRial ?? products[0].price_rial;
        }
        if (!name || price === undefined) throw new Error('شرح و قیمت ردیف دستی لازم است.');
        assertRial(price);
        const total = BigInt(price) * BigInt(input.quantity);
        if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('مبلغ فاکتور بیش از حد مجاز است.');
        lines.push({ productId: input.productId, name, quantity: input.quantity, unitPriceRial: price, totalRial: Number(total) });
      }
      const total = lines.reduce((sum, line) => sum + BigInt(line.totalRial), 0n);
      if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('مجموع فاکتور بیش از حد مجاز است.');
      const template = await this.loadTemplate();
      const receipt: InvoiceReceipt = { id: requestId, number, at: now, customerName: customerName.trim(), lines, totalRial: Number(total), templateVersionId: template?.id, templateFields: template?.fields };
      let customerId: string | null = null;
      if (receipt.customerName) {
        customerId = crypto.randomUUID();
        await this.db.run('INSERT INTO customer(id,store_id,name,created_at) VALUES(?,?,?,?)', [customerId, this.storeId, receipt.customerName, now]);
      }
      const revisionId = crypto.randomUUID();
      await this.db.run(`INSERT INTO invoice(id,store_id,customer_id,invoice_number,status,current_revision,created_at,issued_at)
        VALUES(?,?,?,?,?,?,?,?)`, [requestId, this.storeId, customerId, number, 'issued', 1, now, now]);
      await this.db.run(`INSERT INTO invoice_revision(id,invoice_id,revision_no,template_version_id,snapshot_json,subtotal_rial,discount_rial,shipping_rial,grand_total_rial,paid_rial,balance_rial,reason,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, [revisionId, requestId, 1, template?.id ?? null, JSON.stringify(receipt), receipt.totalRial, 0, 0, receipt.totalRial, 0, receipt.totalRial, 'issue', now]);
      for (const line of lines) {
        await this.db.run(`INSERT INTO invoice_line(id,invoice_revision_id,product_id,name_snapshot,unit_snapshot,quantity_milli,unit_price_rial,discount_rial,line_total_rial)
          VALUES(?,?,?,?,?,?,?,?,?)`, [crypto.randomUUID(), revisionId, line.productId ?? null, line.name, 'عدد', line.quantity * 1000, line.unitPriceRial, 0, line.totalRial]);
        if (line.productId) {
          const quantityMilli = line.quantity * 1000;
          if (!Number.isSafeInteger(quantityMilli)) throw new Error('تعداد کالا بیش از حد مجاز است.');
          const result = await this.db.run('UPDATE stock_balance SET quantity_milli=quantity_milli-? WHERE product_id=? AND quantity_milli>=?', [quantityMilli, line.productId, quantityMilli]);
          if (result.changes !== 1) throw new Error(`موجودی «${line.name}» کافی نیست.`);
          await this.db.run('INSERT INTO stock_movement(id,product_id,quantity_milli,reason,invoice_revision_id,created_at) VALUES(?,?,?,?,?,?)', [crypto.randomUUID(), line.productId, -quantityMilli, 'sale', revisionId, now]);
        }
      }
      await this.audit('invoice', requestId, 'issue', { number, totalRial: receipt.totalRial }, now);
      return receipt;
    });
  }

  async listInvoices(): Promise<InvoiceReceipt[]> {
    const rows = await this.db.query<{ snapshot_json: string }>(`SELECT r.snapshot_json FROM invoice i JOIN invoice_revision r ON r.invoice_id=i.id
      WHERE i.store_id=? AND i.status='issued' AND r.revision_no=i.current_revision ORDER BY i.invoice_number DESC`, [this.storeId]);
    return rows.map(row => JSON.parse(row.snapshot_json) as InvoiceReceipt);
  }

  private async audit(type: string, id: string, action: string, payload: object, at: string): Promise<void> {
    await this.db.run('INSERT INTO audit_event(id,store_id,entity_type,entity_id,action,payload_json,actor,created_at) VALUES(?,?,?,?,?,?,?,?)', [crypto.randomUUID(), this.storeId, type, id, action, JSON.stringify(payload), 'owner', at]);
  }
}
