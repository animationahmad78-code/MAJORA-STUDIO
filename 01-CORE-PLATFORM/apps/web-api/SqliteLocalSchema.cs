using System.Data.Common;

namespace Majora.WebApi;

public static class SqliteLocalSchema
{
    // Only used for the existing single-user Development installation. The
    // reviewed EF migration is used for production SQL Server deployments.
    public static async Task EnsureRequestHashesAsync(DbConnection connection)
    {
        foreach (var table in new[] { "SubscriptionOrders", "PriceBatches", "Invoices", "Payments", "SalesReturns", "Refunds", "Purchases" })
        {
            using var columns = connection.CreateCommand();
            columns.CommandText = $"PRAGMA table_info({table})";
            using var reader = await columns.ExecuteReaderAsync();
            var hasColumn = false;
            while (await reader.ReadAsync())
                if (string.Equals(reader.GetString(1), "RequestHash", StringComparison.OrdinalIgnoreCase)) hasColumn = true;
            await reader.CloseAsync();
            if (hasColumn) continue;
            using var upgrade = connection.CreateCommand();
            upgrade.CommandText = $"ALTER TABLE {table} ADD COLUMN RequestHash TEXT NOT NULL DEFAULT ''";
            await upgrade.ExecuteNonQueryAsync();
        }
    }
}
