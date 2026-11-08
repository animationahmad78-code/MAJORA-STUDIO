namespace Majora.WebApi;

public static class ProductPhotos
{
    public static bool TryDecode(string dataUrl, out string contentType, out byte[] bytes)
    {
        contentType = "";
        bytes = [];
        if (string.IsNullOrWhiteSpace(dataUrl) || dataUrl.Length > 1_400_000) return false;
        var comma = dataUrl.IndexOf(',');
        if (comma < 0 || comma > 30) return false;
        var prefix = dataUrl[..comma];
        if (prefix is not ("data:image/jpeg;base64" or "data:image/png;base64" or "data:image/webp;base64")) return false;
        try { bytes = Convert.FromBase64String(dataUrl[(comma + 1)..]); }
        catch (FormatException) { return false; }
        if (bytes.Length is < 50 or > 1_000_000) return false;
        var png = bytes.Length > 8 && bytes.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 });
        var jpeg = bytes.Length > 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff;
        var webp = bytes.Length > 12 && bytes.AsSpan(0, 4).SequenceEqual("RIFF"u8) && bytes.AsSpan(8, 4).SequenceEqual("WEBP"u8);
        contentType = png ? "image/png" : jpeg ? "image/jpeg" : webp ? "image/webp" : "";
        return prefix == $"data:{contentType};base64";
    }
}
