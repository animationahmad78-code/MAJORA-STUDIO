using System.Text;

namespace Majora.WebApi;

public static class IranPhone
{
    // Empty is allowed when the buyer did not provide a contact number.
    // Persist a single 11-digit form so search and customer matching agree.
    public static string? NormalizeOptional(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "";
        var digits = new StringBuilder(11);
        foreach (var ch in value)
        {
            if (ch is >= '0' and <= '9') digits.Append(ch);
            else if (ch is >= '۰' and <= '۹') digits.Append((char)('0' + ch - '۰'));
            else if (ch is >= '٠' and <= '٩') digits.Append((char)('0' + ch - '٠'));
            else if (char.IsWhiteSpace(ch) || ch is '-' or '(' or ')') continue;
            else return null;
            if (digits.Length > 11) return null;
        }
        var result = digits.ToString();
        return result.Length == 11 && result[0] == '0' && result[1] != '0' ? result : null;
    }
}
