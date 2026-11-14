namespace Majora.WebApi;

public static class MarketingImages
{
    public static bool TryDecodeLandscape(string dataUrl, out string contentType, out byte[] bytes)
    {
        contentType = "";
        bytes = [];
        if (!ProductPhotos.TryDecode(dataUrl, out contentType, out bytes) ||
            contentType is not ("image/png" or "image/jpeg")) return false;
        var dimensions = contentType == "image/png" ? PngSize(bytes) : JpegSize(bytes);
        if (dimensions is not { } size || size.Width < 640 || size.Height < 360 ||
            size.Width > 3840 || size.Height > 2160) return false;
        return Math.Abs((double)size.Width / size.Height - 16d / 9d) < 0.02;
    }

    public static bool ValidTarget(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return false;
        var text = value.Trim();
        if (text.StartsWith("/#/", StringComparison.Ordinal))
            return text.Length <= 100 && text[3..].All(c => char.IsAsciiLetterLower(c) || c is '-' or '/');
        return Uri.TryCreate(text, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps &&
            uri.UserInfo.Length == 0 && uri.Host.Length > 0;
    }

    private static (int Width, int Height)? PngSize(byte[] bytes)
    {
        if (bytes.Length < 24 || !bytes.AsSpan(12, 4).SequenceEqual("IHDR"u8)) return null;
        var width = System.Buffers.Binary.BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(16, 4));
        var height = System.Buffers.Binary.BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(20, 4));
        return (width, height);
    }

    private static (int Width, int Height)? JpegSize(byte[] bytes)
    {
        for (var i = 2; i + 8 < bytes.Length;)
        {
            if (bytes[i++] != 0xff) continue;
            while (i < bytes.Length && bytes[i] == 0xff) i++;
            if (i >= bytes.Length) break;
            var marker = bytes[i++];
            if (marker is 0xd9 or 0xda) break;
            if (marker is 0x01 or >= 0xd0 and <= 0xd7) continue;
            if (i + 2 > bytes.Length) break;
            var length = (bytes[i] << 8) | bytes[i + 1];
            if (length < 2 || i + length > bytes.Length) break;
            if (marker is 0xc0 or 0xc1 or 0xc2 or 0xc3 or 0xc5 or 0xc6 or 0xc7 or 0xc9 or 0xca or 0xcb or 0xcd or 0xce or 0xcf)
                return ((bytes[i + 5] << 8) | bytes[i + 6], (bytes[i + 3] << 8) | bytes[i + 4]);
            i += length;
        }
        return null;
    }
}
