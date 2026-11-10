using Microsoft.EntityFrameworkCore;

namespace Majora.WebApi;

public sealed record SalesMetrics(int InvoiceCount, long IssuedRial, long ReturnsRial,
    long NetSalesRial, long ReceivableRial, long RefundDueRial);

public static class FinanceMath
{
    public static long NetTotal(Invoice invoice) => checked(invoice.TotalRial - invoice.ReturnedRial);
    public static long NetPaid(Invoice invoice) => checked(invoice.PaidRial - invoice.RefundedRial);
    public static long Receivable(Invoice invoice) => Math.Max(0, checked(NetTotal(invoice) - NetPaid(invoice)));
    public static long RefundDue(Invoice invoice) => Math.Max(0, checked(NetPaid(invoice) - NetTotal(invoice)));

    public static SalesMetrics SummarizeSales(IReadOnlyCollection<Invoice> issued, long returnsRial,
        IReadOnlyCollection<Invoice> openInvoices)
    {
        var issuedRial = issued.Sum(x => x.TotalRial);
        return new SalesMetrics(issued.Count, issuedRial, returnsRial,
            checked(issuedRial - returnsRial), openInvoices.Sum(Receivable), openInvoices.Sum(RefundDue));
    }

    public static async Task<SalesMetrics> LoadSalesMetricsAsync(MajoraDb db, Guid tenantId, DateTime since)
    {
        var issued = await db.Invoices.AsNoTracking().Where(x => x.TenantId == tenantId &&
            x.Status == "issued" && x.PaymentStatus != "proforma" && x.IssuedAt >= since).ToListAsync();
        var returnsRial = await db.SalesReturns.AsNoTracking().Where(x => x.TenantId == tenantId &&
            x.CreatedAt >= since).SumAsync(x => x.AmountRial);
        var open = await db.Invoices.AsNoTracking().Where(x => x.TenantId == tenantId &&
            x.Status == "issued" && x.PaymentStatus != "proforma").ToListAsync();
        return SummarizeSales(issued, returnsRial, open);
    }

    public static void UpdateStatus(Invoice invoice)
    {
        if (invoice.PaymentStatus == "proforma") return;
        var total = NetTotal(invoice);
        var paid = NetPaid(invoice);
        invoice.PaymentStatus = paid > total ? "refund_due"
            : total == 0 ? "returned"
            : paid == total ? "paid"
            : paid > 0 ? "partial"
            : "unpaid";
    }
}
