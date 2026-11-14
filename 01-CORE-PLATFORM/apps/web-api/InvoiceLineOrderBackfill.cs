using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Majora.WebApi;

public static class InvoiceLineOrderBackfill
{
    // Historical invoices were saved before Position existed. Their revision
    // snapshot contains the original line array, even if EF later read the
    // invoice collection in an arbitrary order.
    public static async Task RunAsync(MajoraDb db)
    {
        var invoiceIds = await db.InvoiceLines.AsNoTracking().Where(x => x.Position == 0)
            .Select(x => x.InvoiceId).Distinct().ToListAsync();
        foreach (var invoiceId in invoiceIds)
        {
            var snapshot = await db.InvoiceRevisions.AsNoTracking().Where(x => x.InvoiceId == invoiceId)
                .OrderByDescending(x => x.RevisionNo).Select(x => x.SnapshotJson).FirstOrDefaultAsync();
            var positions = new Dictionary<Guid, int>();
            if (!string.IsNullOrWhiteSpace(snapshot))
            {
                try
                {
                    using var document = JsonDocument.Parse(snapshot);
                    if (document.RootElement.TryGetProperty("lines", out var lines) && lines.ValueKind == JsonValueKind.Array)
                    {
                        var position = 1;
                        foreach (var line in lines.EnumerateArray())
                        {
                            if (line.TryGetProperty("id", out var id) && id.TryGetGuid(out var lineId))
                                positions[lineId] = position;
                            position++;
                        }
                    }
                }
                catch (JsonException) { /* Use a stable fallback for an invalid historical snapshot. */ }
            }
            var stored = await db.InvoiceLines.Where(x => x.InvoiceId == invoiceId).ToListAsync();
            var nextPosition = Math.Max(0, positions.Values.DefaultIfEmpty().Max());
            foreach (var line in stored.OrderBy(x => x.Id))
            {
                if (line.Position != 0) continue;
                if (!positions.TryGetValue(line.Id, out var position)) position = ++nextPosition;
                line.Position = position;
            }
            await db.SaveChangesAsync();
            db.ChangeTracker.Clear();
        }
    }
}
