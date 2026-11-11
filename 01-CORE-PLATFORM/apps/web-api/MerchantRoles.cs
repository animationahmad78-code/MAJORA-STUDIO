namespace Majora.WebApi;

// A role is checked on every merchant request before the endpoint runs. Keep this
// list explicit: a new route must not silently become available to staff.
public static class MerchantRoles
{
    public static readonly IReadOnlyDictionary<string, string> Names = new Dictionary<string, string>
    {
        ["owner"] = "مالک", ["manager"] = "مدیر", ["staff"] = "فروشنده",
        ["cashier"] = "صندوق‌دار", ["warehouse"] = "انباردار",
        ["accountant"] = "حسابدار", ["viewer"] = "مشاهده‌گر"
    };

    public static bool Allows(string role, string path, string method)
    {
        if (!Names.ContainsKey(role)) return false;
        if (role == "owner") return true;
        var p = path.StartsWith("/api/merchant", StringComparison.OrdinalIgnoreCase) ? path[13..] : path;
        var read = method.Equals("GET", StringComparison.OrdinalIgnoreCase);
        if (p is "/features" or "/workspace" or "/sessions") return read;
        if (p.StartsWith("/sessions/", StringComparison.OrdinalIgnoreCase)) return method == "POST" && p.EndsWith("/revoke", StringComparison.OrdinalIgnoreCase);
        if (role == "manager") return true; // Staff and activity mutations still require owner inside their endpoint.
        if (p.StartsWith("/staff", StringComparison.OrdinalIgnoreCase) || p.StartsWith("/activity", StringComparison.OrdinalIgnoreCase)) return false;
        if (read)
        {
            var knownRead = new[] { "/dashboard", "/search", "/products", "/customers", "/invoices",
                "/archive", "/invoice-brand", "/accounting", "/reminders", "/advisor",
                "/subscription", "/plans", "/billing", "/price-batches" }
                .Any(prefix => p.Equals(prefix, StringComparison.OrdinalIgnoreCase) ||
                    p.StartsWith(prefix + "/", StringComparison.OrdinalIgnoreCase));
            if (!knownRead) return false;
            // The viewer's navigation contains only the sales read views. Keep the
            // API equally narrow; hiding accounting and billing tabs is not access control.
            if (role == "viewer")
                return new[] { "/dashboard", "/search", "/products", "/customers", "/invoices", "/invoice-brand" }
                    .Any(prefix => p.Equals(prefix, StringComparison.OrdinalIgnoreCase) ||
                        p.StartsWith(prefix + "/", StringComparison.OrdinalIgnoreCase));
            if (role == "warehouse") return p.StartsWith("/products", StringComparison.OrdinalIgnoreCase);
            if (p.StartsWith("/subscription", StringComparison.OrdinalIgnoreCase) || p.StartsWith("/plans", StringComparison.OrdinalIgnoreCase) || p.StartsWith("/billing", StringComparison.OrdinalIgnoreCase)) return role == "accountant";
            if (p.StartsWith("/price-batches", StringComparison.OrdinalIgnoreCase) || p.StartsWith("/archive", StringComparison.OrdinalIgnoreCase)) return false;
            if (p.StartsWith("/accounting", StringComparison.OrdinalIgnoreCase))
                return role == "accountant" || p.StartsWith("/accounting/returns", StringComparison.OrdinalIgnoreCase);
            if (p.StartsWith("/advisor", StringComparison.OrdinalIgnoreCase)) return role == "accountant";
            return true;
        }
        if (role == "viewer") return false;
        if (role == "warehouse")
            return (method == "POST" && p == "/products") ||
                ((method == "PUT" || method == "DELETE") && p.StartsWith("/products/", StringComparison.OrdinalIgnoreCase) && !p.EndsWith("/price", StringComparison.OrdinalIgnoreCase));
        if (role == "accountant")
            return (p.StartsWith("/accounting/", StringComparison.OrdinalIgnoreCase) && method is "POST" or "PUT") ||
                (p.StartsWith("/invoices/", StringComparison.OrdinalIgnoreCase) && method == "POST" &&
                 (p.EndsWith("/payments", StringComparison.OrdinalIgnoreCase) || p.EndsWith("/refunds", StringComparison.OrdinalIgnoreCase))) ||
                (p.StartsWith("/reminders", StringComparison.OrdinalIgnoreCase) && method is "POST" or "PUT");
        // Cashiers and existing staff can serve customers; they cannot change prices or accounting records.
        return (p.StartsWith("/invoices", StringComparison.OrdinalIgnoreCase) && method == "POST") ||
            (p == "/customers" && method == "POST") ||
            (p.StartsWith("/reminders", StringComparison.OrdinalIgnoreCase) && method is "POST" or "PUT");
    }
}
