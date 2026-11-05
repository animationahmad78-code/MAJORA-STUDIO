namespace Majora.WebApi;

public static class FinanceMath
{
    public static long NetTotal(Invoice invoice) => checked(invoice.TotalRial - invoice.ReturnedRial);
    public static long NetPaid(Invoice invoice) => checked(invoice.PaidRial - invoice.RefundedRial);
    public static long Receivable(Invoice invoice) => Math.Max(0, checked(NetTotal(invoice) - NetPaid(invoice)));
    public static long RefundDue(Invoice invoice) => Math.Max(0, checked(NetPaid(invoice) - NetTotal(invoice)));

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
