CREATE TABLE IF NOT EXISTS invoice_finance (
  invoice_id TEXT PRIMARY KEY REFERENCES invoice(id),
  status TEXT NOT NULL CHECK(status IN ('settled','partial','unpaid','proforma')),
  paid_rial INTEGER NOT NULL DEFAULT 0 CHECK(paid_rial>=0),
  returned_rial INTEGER NOT NULL DEFAULT 0 CHECK(returned_rial>=0),
  shipping_returned_rial INTEGER NOT NULL DEFAULT 0 CHECK(shipping_returned_rial>=0),
  refunded_rial INTEGER NOT NULL DEFAULT 0 CHECK(refunded_rial>=0),
  due_jalali TEXT,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO invoice_finance(invoice_id,status,paid_rial,due_jalali,updated_at)
SELECT i.id, CASE WHEN r.paid_rial>=r.grand_total_rial THEN 'settled' WHEN r.paid_rial>0 THEN 'partial' ELSE 'unpaid' END,
       r.paid_rial, NULL, COALESCE(i.issued_at,i.created_at)
FROM invoice i JOIN invoice_revision r ON r.invoice_id=i.id AND r.revision_no=i.current_revision
WHERE i.status='issued';
CREATE TABLE IF NOT EXISTS invoice_payment_event (
  id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoice(id), amount_rial INTEGER NOT NULL CHECK(amount_rial>0),
  direction TEXT NOT NULL CHECK(direction IN ('receive','refund')),
  method TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS invoice_payment_timeline ON invoice_payment_event(invoice_id,created_at);
INSERT OR IGNORE INTO invoice_payment_event(id,invoice_id,amount_rial,direction,method,note,created_at)
SELECT 'legacy-'||i.id,i.id,f.paid_rial,'receive','legacy','پرداخت ثبت‌شده در نسخهٔ قبلی',COALESCE(i.issued_at,i.created_at)
FROM invoice i JOIN invoice_finance f ON f.invoice_id=i.id WHERE f.paid_rial>0;
CREATE TABLE IF NOT EXISTS sales_return (
  id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoice(id), invoice_revision_id TEXT NOT NULL REFERENCES invoice_revision(id),
  amount_rial INTEGER NOT NULL CHECK(amount_rial>=0), reason TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sales_return_line (
  id TEXT PRIMARY KEY, return_id TEXT NOT NULL REFERENCES sales_return(id), line_index INTEGER NOT NULL,
  product_id TEXT REFERENCES product(id), name_snapshot TEXT NOT NULL, quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
  amount_rial INTEGER NOT NULL CHECK(amount_rial>=0), restocked INTEGER NOT NULL CHECK(restocked IN (0,1))
);
CREATE INDEX IF NOT EXISTS sales_return_invoice ON sales_return(invoice_id,created_at);
CREATE TABLE IF NOT EXISTS purchase_entry (
  id TEXT PRIMARY KEY, supplier TEXT NOT NULL, total_rial INTEGER NOT NULL CHECK(total_rial>=0),
  paid_rial INTEGER NOT NULL CHECK(paid_rial>=0), due_jalali TEXT, note TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS purchase_line (
  id TEXT PRIMARY KEY, purchase_id TEXT NOT NULL REFERENCES purchase_entry(id), product_id TEXT REFERENCES product(id),
  quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0), unit_cost_rial INTEGER NOT NULL CHECK(unit_cost_rial>=0),
  line_total_rial INTEGER NOT NULL CHECK(line_total_rial>=0)
);
CREATE TABLE IF NOT EXISTS purchase_payment_event (
  id TEXT PRIMARY KEY, purchase_id TEXT NOT NULL REFERENCES purchase_entry(id), amount_rial INTEGER NOT NULL CHECK(amount_rial>0),
  method TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS expense_entry (
  id TEXT PRIMARY KEY, category TEXT NOT NULL, description TEXT NOT NULL, amount_rial INTEGER NOT NULL CHECK(amount_rial>0),
  settled INTEGER NOT NULL CHECK(settled IN (0,1)), due_jalali TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cheque_entry (
  id TEXT PRIMARY KEY, direction TEXT NOT NULL CHECK(direction IN ('received','issued')),
  party TEXT NOT NULL, serial TEXT NOT NULL, bank TEXT, amount_rial INTEGER NOT NULL CHECK(amount_rial>0),
  due_jalali TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('open','cleared','returned','cancelled')),
  note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cheque_due ON cheque_entry(status,due_jalali);
CREATE TABLE IF NOT EXISTS finance_journal (
  id TEXT PRIMARY KEY, source_type TEXT NOT NULL, source_id TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(source_type,source_id)
);
CREATE TABLE IF NOT EXISTS finance_journal_line (
  id TEXT PRIMARY KEY, journal_id TEXT NOT NULL REFERENCES finance_journal(id), account TEXT NOT NULL,
  debit_rial INTEGER NOT NULL DEFAULT 0 CHECK(debit_rial>=0), credit_rial INTEGER NOT NULL DEFAULT 0 CHECK(credit_rial>=0),
  CHECK((debit_rial>0 AND credit_rial=0) OR (credit_rial>0 AND debit_rial=0))
);
CREATE INDEX IF NOT EXISTS finance_journal_account ON finance_journal_line(account,journal_id);
INSERT OR IGNORE INTO finance_journal(id,source_type,source_id,note,created_at)
SELECT 'legacy-sale-'||i.id,'sale',i.id,'فروش ثبت‌شده در نسخهٔ قبلی',COALESCE(i.issued_at,i.created_at)
FROM invoice i JOIN invoice_revision r ON r.invoice_id=i.id AND r.revision_no=i.current_revision
WHERE i.status='issued' AND r.grand_total_rial>0;
INSERT OR IGNORE INTO finance_journal_line(id,journal_id,account,debit_rial,credit_rial)
SELECT 'legacy-sale-ar-'||i.id,'legacy-sale-'||i.id,'receivable',r.grand_total_rial,0
FROM invoice i JOIN invoice_revision r ON r.invoice_id=i.id AND r.revision_no=i.current_revision
WHERE i.status='issued' AND r.grand_total_rial>0;
INSERT OR IGNORE INTO finance_journal_line(id,journal_id,account,debit_rial,credit_rial)
SELECT 'legacy-sale-revenue-'||i.id,'legacy-sale-'||i.id,'sales',0,r.grand_total_rial-r.shipping_rial
FROM invoice i JOIN invoice_revision r ON r.invoice_id=i.id AND r.revision_no=i.current_revision
WHERE i.status='issued' AND r.grand_total_rial>r.shipping_rial;
INSERT OR IGNORE INTO finance_journal_line(id,journal_id,account,debit_rial,credit_rial)
SELECT 'legacy-sale-shipping-'||i.id,'legacy-sale-'||i.id,'shipping_income',0,r.shipping_rial
FROM invoice i JOIN invoice_revision r ON r.invoice_id=i.id AND r.revision_no=i.current_revision
WHERE i.status='issued' AND r.shipping_rial>0;
INSERT OR IGNORE INTO finance_journal(id,source_type,source_id,note,created_at)
SELECT 'legacy-receipt-'||i.id,'receipt',i.id,'دریافت ثبت‌شده در نسخهٔ قبلی',COALESCE(i.issued_at,i.created_at)
FROM invoice i JOIN invoice_finance f ON f.invoice_id=i.id WHERE f.paid_rial>0;
INSERT OR IGNORE INTO finance_journal_line(id,journal_id,account,debit_rial,credit_rial)
SELECT 'legacy-receipt-cash-'||i.id,'legacy-receipt-'||i.id,'cash_bank',f.paid_rial,0
FROM invoice i JOIN invoice_finance f ON f.invoice_id=i.id WHERE f.paid_rial>0;
INSERT OR IGNORE INTO finance_journal_line(id,journal_id,account,debit_rial,credit_rial)
SELECT 'legacy-receipt-ar-'||i.id,'legacy-receipt-'||i.id,'receivable',0,f.paid_rial
FROM invoice i JOIN invoice_finance f ON f.invoice_id=i.id WHERE f.paid_rial>0;
INSERT INTO schema_migrations(version,applied_at) VALUES(4,datetime('now'));
