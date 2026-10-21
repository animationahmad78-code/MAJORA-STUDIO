ALTER TABLE product ADD COLUMN model TEXT;
ALTER TABLE product ADD COLUMN color TEXT;
ALTER TABLE customer ADD COLUMN first_name TEXT;
ALTER TABLE customer ADD COLUMN last_name TEXT;
CREATE INDEX IF NOT EXISTS product_category_active ON product(store_id, category_id, archived_at);
INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(2,datetime('now'));
