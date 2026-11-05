using System.Text.Json;

namespace Majora.WebApi;

public sealed record InvoiceBrandView(
    int Revision, string StoreName, string Slogan, string Phone, string Address,
    string Card, string CardHolder, string Note, List<string> Conditions,
    string SocialTelegram, string SocialInstagram, string SocialContact, string? LogoDataUrl);

public sealed record InvoiceBrandUpdate(
    int Revision, string StoreName, string Slogan, string Phone, string Address,
    string Card, string CardHolder, string Note, List<string> Conditions,
    string SocialTelegram, string SocialInstagram, string SocialContact, string? LogoDataUrl);

public static class InvoiceBrand
{
    private static readonly JsonSerializerOptions WebJson = new(JsonSerializerDefaults.Web);

    public static InvoiceBrandProfile Create(Guid tenantId, string tenantName, bool classicPreset, string? webRoot)
    {
        var profile = new InvoiceBrandProfile { TenantId = tenantId, StoreName = tenantName };
        if (!classicPreset) return profile;

        profile.StoreName = "کیف و کمربند کلاسیک";
        profile.Slogan = "استایل کامل از کیف و کمربند";
        profile.Phone = "051-33662794 | 051-33662795 | 0910-500-3669";
        profile.Address = "مشهد، بلوار مصلی، بازار مولوی، فاز یک، طبقه فوقانی، پلاک ۱۴۰ و ۱۴۱";
        profile.Card = "6219861034642404";
        profile.CardHolder = "رضا ابراهیم‌زاده";
        profile.Note = "حتماً فیش واریزی را به شماره همراه فوق در پیامک و یا فضای مجازی ارسال بفرمایید.";
        profile.ConditionsJson = JsonSerializer.Serialize(new[] {
            "اجناس فوق صحیح و سالم به خریدار تحویل گردید. این فاکتور سند بدهی خریدار بوده و تا تسویه کامل، اجناس نزد وی شرعاً و قانوناً امانت محسوب می‌شود.",
            "خریدار موظف است تعداد، مدل، رنگ و مشخصات کالاهای دریافتی را با فاکتور تطبیق داده و هرگونه مغایرت ظاهری را در اولین فرصت به فروشنده اطلاع دهد.",
            "کالاهای دارای ایراد تولید یا مغایرت با سفارش، پس از بررسی و تأیید، مطابق توافق و مقررات مربوط تعیین تکلیف می‌شوند.",
            "هزینه ارسال و مسئولیت حمل کالا طبق توافق طرفین و روش ارسال درج‌شده در فاکتور تعیین می‌شود.",
            "در فروش اعتباری، خریدار موظف است مانده بدهی را در تاریخ سررسید مندرج در فاکتور تسویه نماید.",
            "قیمت‌ها و تخفیفات این فاکتور مختص همین معامله بوده و شامل سفارش‌های آینده نمی‌شوند."
        });
        profile.SocialTelegram = "@CLASSICBAG33662880";
        profile.SocialInstagram = "@CLASSIC_STORE_GALLERY";
        profile.SocialContact = "@CLASSIC33662795";
        var logoPath = webRoot is null ? null : Path.Combine(webRoot, "store-logo-gold.png");
        if (logoPath is not null && File.Exists(logoPath))
            profile.LogoDataUrl = "data:image/png;base64," + Convert.ToBase64String(File.ReadAllBytes(logoPath));
        return profile;
    }

    public static InvoiceBrandView View(InvoiceBrandProfile profile) => new(
        profile.Revision, profile.StoreName, profile.Slogan, profile.Phone, profile.Address,
        profile.Card, profile.CardHolder, profile.Note,
        JsonSerializer.Deserialize<List<string>>(profile.ConditionsJson) ?? [],
        profile.SocialTelegram, profile.SocialInstagram, profile.SocialContact, profile.LogoDataUrl);

    public static string Snapshot(InvoiceBrandProfile profile) => JsonSerializer.Serialize(View(profile), WebJson);

    public static string? Validate(InvoiceBrandUpdate input)
    {
        if (input.Revision < 1 || string.IsNullOrWhiteSpace(input.StoreName) || input.StoreName.Length > 200)
            return "نام فروشگاه یا نسخهٔ قالب نامعتبر است.";
        var fields = new[] { input.Slogan, input.Phone, input.Address, input.Card, input.CardHolder,
            input.Note, input.SocialTelegram, input.SocialInstagram, input.SocialContact };
        if (fields.Any(x => x is null || x.Length > 1000) || input.Conditions is null || input.Conditions.Count > 12 ||
            input.Conditions.Any(x => x is null || x.Length > 1500)) return "متن فاکتور بیش از حد مجاز است.";
        if (!string.IsNullOrEmpty(input.LogoDataUrl) && !IsValidLogo(input.LogoDataUrl))
            return "لوگو باید PNG، JPEG یا WebP و حداکثر یک مگابایت باشد.";
        return null;
    }

    private static bool IsValidLogo(string dataUrl)
    {
        if (dataUrl.Length > 1_400_000) return false;
        var comma = dataUrl.IndexOf(',');
        if (comma < 0) return false;
        var media = dataUrl[..comma];
        if (media is not ("data:image/png;base64" or "data:image/jpeg;base64" or "data:image/webp;base64")) return false;
        try
        {
            var bytes = Convert.FromBase64String(dataUrl[(comma + 1)..]);
            if (bytes.Length is < 100 or > 1_048_576) return false;
            return media switch {
                "data:image/png;base64" => bytes.AsSpan().StartsWith(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }),
                "data:image/jpeg;base64" => bytes[0] == 255 && bytes[1] == 216,
                _ => bytes.AsSpan().StartsWith("RIFF"u8) && bytes.AsSpan(8).StartsWith("WEBP"u8)
            };
        }
        catch (FormatException) { return false; }
    }

    public static void Apply(InvoiceBrandProfile target, InvoiceBrandUpdate input)
    {
        target.StoreName = input.StoreName.Trim(); target.Slogan = input.Slogan.Trim();
        target.Phone = input.Phone.Trim(); target.Address = input.Address.Trim();
        target.Card = input.Card.Trim(); target.CardHolder = input.CardHolder.Trim();
        target.Note = input.Note.Trim(); target.ConditionsJson = JsonSerializer.Serialize(input.Conditions.Select(x => x.Trim()));
        target.SocialTelegram = input.SocialTelegram.Trim(); target.SocialInstagram = input.SocialInstagram.Trim();
        target.SocialContact = input.SocialContact.Trim(); target.LogoDataUrl = input.LogoDataUrl;
        target.Revision++; target.UpdatedAt = DateTime.UtcNow;
    }
}
