"""Validate the SQLite migration using Python's standard library."""
from pathlib import Path
import sqlite3

root = Path(__file__).resolve().parents[1]
sql = (root / "packages/database/migrations/001_init.sql").read_text(encoding="utf-8")
connection = sqlite3.connect(":memory:")
connection.executescript(sql)
issues = connection.execute("PRAGMA foreign_key_check").fetchall()
assert not issues, issues
tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
required = {"store", "product", "price_batch", "price_event", "stock_movement", "invoice", "invoice_revision", "invoice_line", "template_version", "audit_event"}
assert required <= tables, required - tables
print(f"SQLite schema OK: {len(tables)} tables")
