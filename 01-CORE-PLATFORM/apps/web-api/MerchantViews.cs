using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Majora.WebApi;

public static class MerchantViews
{
    public static bool CanSeeCost(ClaimsPrincipal user) =>
        user.IsInRole("owner") || user.IsInRole("manager") || user.IsInRole("accountant");

    public static object Product(Product product, ClaimsPrincipal user)
    {
        var canSeeCost = CanSeeCost(user);
        return new
        {
            product.Id, product.TenantId, product.Name, product.Sku, product.Category,
            product.PriceRial, product.Stock, product.Archived, product.HasPhoto, product.UpdatedAt,
            AverageCostRial = canSeeCost ? (long?)product.AverageCostRial : null,
            CostKnown = canSeeCost ? (bool?)product.CostKnown : null
        };
    }

    public static JsonNode RedactInvoiceCosts(Invoice invoice) =>
        RedactInvoiceCostNode(JsonSerializer.SerializeToNode(invoice, JsonSerializerOptions.Web))!;

    public static string RedactInvoiceSnapshotCosts(string snapshot)
    {
        return RedactInvoiceCostNode(JsonNode.Parse(snapshot))?.ToJsonString() ?? "{}";
    }

    private static JsonNode? RedactInvoiceCostNode(JsonNode? root)
    {
        if (root is JsonObject invoice && invoice["lines"] is JsonArray lines)
            foreach (var line in lines.OfType<JsonObject>())
            {
                line.Remove("unitCostRialSnapshot");
                line.Remove("costKnown");
            }
        return root;
    }
}
