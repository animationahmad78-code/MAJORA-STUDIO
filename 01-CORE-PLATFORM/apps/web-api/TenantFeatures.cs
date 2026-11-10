using System.Text.Json;

namespace Majora.WebApi;

// The owner's feature policy is enforced before every merchant endpoint runs.
// Unknown keys fail closed on updates so a misspelling cannot silently grant access.
public static class TenantFeatures
{
    public static readonly IReadOnlyDictionary<string, string> Names = new Dictionary<string, string>
    {
        ["sale"] = "فروش جدید", ["products"] = "کالاها", ["prices"] = "ویرایش قیمت",
        ["customers"] = "مشتریان", ["invoices"] = "فاکتورها", ["archive"] = "بایگانی",
        ["returns"] = "مرجوعی‌ها", ["invoice-brand"] = "قالب فاکتور",
        ["accounting"] = "مالی و خرید", ["cheques"] = "چک‌ها", ["reminders"] = "یادآورها",
        ["advisor"] = "تحلیل کسب‌وکار", ["staff"] = "همکاران"
    };

    public static readonly IReadOnlyDictionary<string, string[]> Dependencies = new Dictionary<string, string[]>
    {
        ["sale"] = ["products", "customers", "invoices"],
        ["prices"] = ["products"],
        ["returns"] = ["invoices", "accounting"],
        ["archive"] = ["products", "customers", "invoices"],
        ["invoice-brand"] = ["invoices"],
        ["cheques"] = ["accounting"],
        ["advisor"] = ["accounting"]
    };

    public static HashSet<string> Read(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try { return JsonSerializer.Deserialize<string[]>(json)?.ToHashSet(StringComparer.Ordinal) ?? []; }
        catch (JsonException) { throw new InvalidOperationException("Stored tenant feature policy is invalid."); }
    }

    public static string[] Required(string path, string method)
    {
        var p = path.StartsWith("/api/merchant", StringComparison.OrdinalIgnoreCase)
            ? path[13..] : path;
        if (p.StartsWith("/price-batches", StringComparison.OrdinalIgnoreCase) ||
            p.StartsWith("/products/", StringComparison.OrdinalIgnoreCase) && p.EndsWith("/price", StringComparison.OrdinalIgnoreCase)) return ["prices"];
        if (p.StartsWith("/products", StringComparison.OrdinalIgnoreCase)) return ["products"];
        if (p.StartsWith("/customers", StringComparison.OrdinalIgnoreCase)) return ["customers"];
        if (p.StartsWith("/archive", StringComparison.OrdinalIgnoreCase)) return ["archive"];
        if (p.StartsWith("/invoice-brand", StringComparison.OrdinalIgnoreCase)) return ["invoice-brand"];
        if (p.StartsWith("/accounting/cheques", StringComparison.OrdinalIgnoreCase)) return ["accounting", "cheques"];
        if (p.StartsWith("/accounting/returns", StringComparison.OrdinalIgnoreCase)) return ["accounting", "returns"];
        if (p.StartsWith("/accounting", StringComparison.OrdinalIgnoreCase)) return ["accounting"];
        if (p.StartsWith("/invoices", StringComparison.OrdinalIgnoreCase))
        {
            if (p.Contains("/returns", StringComparison.OrdinalIgnoreCase) || p.Contains("/refunds", StringComparison.OrdinalIgnoreCase)) return ["invoices", "returns", "accounting"];
            if (p.Contains("/payments", StringComparison.OrdinalIgnoreCase)) return ["invoices", "accounting"];
            if (p.EndsWith("/cheque", StringComparison.OrdinalIgnoreCase)) return ["invoices", "cheques"];
            if (method == "POST" && (p.Equals("/invoices", StringComparison.OrdinalIgnoreCase) || p.EndsWith("/convert", StringComparison.OrdinalIgnoreCase))) return ["sale"];
            return ["invoices"];
        }
        if (p.StartsWith("/reminders", StringComparison.OrdinalIgnoreCase)) return ["reminders"];
        if (p.StartsWith("/advisor", StringComparison.OrdinalIgnoreCase)) return ["advisor"];
        if (p.StartsWith("/staff", StringComparison.OrdinalIgnoreCase) || p.StartsWith("/activity", StringComparison.OrdinalIgnoreCase)) return ["staff"];
        return [];
    }

    public static string? BrokenDependency(ISet<string> disabled) => Dependencies
        .SelectMany(pair => pair.Value.Where(disabled.Contains).Select(dependency => new { Feature = pair.Key, Dependency = dependency }))
        .Where(x => !disabled.Contains(x.Feature))
        .Select(x => $"«{Names[x.Feature]}» به «{Names[x.Dependency]}» نیاز دارد. ابتدا بخش وابسته را هم خاموش کنید.")
        .FirstOrDefault();
}
