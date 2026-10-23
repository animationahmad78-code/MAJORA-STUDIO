ALTER TABLE invoice ADD COLUMN archived_at TEXT;
CREATE INDEX IF NOT EXISTS invoice_archive ON invoice(store_id, archived_at, invoice_number);
INSERT INTO schema_migrations(version,applied_at) VALUES(3,datetime('now'));
