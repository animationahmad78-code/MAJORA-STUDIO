using Microsoft.Data.Sqlite;

if (args.Length == 2 && args[0] == "--inspect")
{
    var inspectPath = Path.GetFullPath(args[1]);
    if (!File.Exists(inspectPath)) throw new FileNotFoundException("Database does not exist.", inspectPath);
    await using var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = inspectPath, Mode = SqliteOpenMode.ReadOnly }.ToString());
    await db.OpenAsync();
    await using var integrity = db.CreateCommand();
    integrity.CommandText = "PRAGMA integrity_check";
    if ((string?)await integrity.ExecuteScalarAsync() != "ok") throw new InvalidDataException("SQLite integrity_check failed.");
    var counts = new Dictionary<string, long>();
    foreach (var table in new[] { "Tenants", "Users", "Products", "Customers", "Invoices", "InvoiceLines" })
    {
        await using var exists = db.CreateCommand();
        exists.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=$name";
        exists.Parameters.AddWithValue("$name", table);
        if ((long)(await exists.ExecuteScalarAsync() ?? 0L) == 0) continue;
        await using var count = db.CreateCommand();
        count.CommandText = $"SELECT COUNT(*) FROM \"{table}\"";
        counts[table] = (long)(await count.ExecuteScalarAsync() ?? 0L);
    }
    long requestHashTables = 0;
    foreach (var table in new[] { "SubscriptionOrders", "PriceBatches", "Invoices", "Payments", "SalesReturns", "Refunds", "Purchases" })
    {
        await using var columns = db.CreateCommand();
        columns.CommandText = $"PRAGMA table_info({table})";
        await using var reader = await columns.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            if (string.Equals(reader.GetString(1), "RequestHash", StringComparison.OrdinalIgnoreCase)) requestHashTables++;
    }
    counts["RequestHashTables"] = requestHashTables;
    Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(counts));
    return 0;
}
if (args.Length != 2)
{
    Console.Error.WriteLine("Usage: SqliteSnapshot <source.db> <new-snapshot.db>");
    return 2;
}

var sourcePath = Path.GetFullPath(args[0]);
var destinationPath = Path.GetFullPath(args[1]);
if (!File.Exists(sourcePath)) throw new FileNotFoundException("Source database does not exist.", sourcePath);
if (File.Exists(destinationPath)) throw new IOException("Snapshot destination already exists. Choose a new path.");
if (string.Equals(sourcePath, destinationPath, StringComparison.OrdinalIgnoreCase)) throw new IOException("Source and destination must differ.");
if (!Directory.Exists(Path.GetDirectoryName(destinationPath))) throw new DirectoryNotFoundException("Snapshot parent directory does not exist.");

try
{
    await using var source = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = sourcePath, Mode = SqliteOpenMode.ReadOnly }.ToString());
    await using var destination = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = destinationPath, Mode = SqliteOpenMode.ReadWriteCreate }.ToString());
    await source.OpenAsync();
    await destination.OpenAsync();
    source.BackupDatabase(destination); // SQLite online backup includes committed WAL pages consistently.
    await destination.CloseAsync();
    await using var verify = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = destinationPath, Mode = SqliteOpenMode.ReadOnly }.ToString());
    await verify.OpenAsync();
    await using var integrity = verify.CreateCommand();
    integrity.CommandText = "PRAGMA integrity_check";
    if ((string?)await integrity.ExecuteScalarAsync() != "ok") throw new InvalidDataException("Snapshot failed SQLite integrity_check.");
    await using var foreignKeys = verify.CreateCommand();
    foreignKeys.CommandText = "PRAGMA foreign_key_check";
    await using var violations = await foreignKeys.ExecuteReaderAsync();
    if (await violations.ReadAsync()) throw new InvalidDataException("Snapshot has foreign key violations.");
    Console.WriteLine("PASS: consistent SQLite snapshot; integrity_check=ok; foreign_key_check=empty");
    return 0;
}
catch
{
    if (File.Exists(destinationPath)) File.Delete(destinationPath);
    throw;
}
