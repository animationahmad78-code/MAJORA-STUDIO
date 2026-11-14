namespace Majora.WebApi;

public static class AnnouncementAssets
{
    public static bool TryFont(string? dataUrl, out byte[] bytes)
    {
        bytes = [];
        const string prefix = "data:font/woff2;base64,";
        if (dataUrl is null || !dataUrl.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) || dataUrl.Length > 720_000) return false;
        try { bytes = Convert.FromBase64String(dataUrl[prefix.Length..]); }
        catch (FormatException) { return false; }
        return bytes.Length is >= 100 and <= 500_000 && bytes.AsSpan(0, 4).SequenceEqual("wOF2"u8);
    }
}
