using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Majora.WebApi;

public static class Idempotency
{
    // Hash the bound request, rather than the raw JSON, so property order and
    // whitespace in the HTTP body cannot turn an exact retry into a conflict.
    public static string Fingerprint<T>(T request) => Convert.ToHexString(
        SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request, JsonSerializerOptions.Web))));

    // Historical rows predate request fingerprints. Their body cannot be proven
    // equivalent to a retry, so they must fail closed rather than claim success.
    public static bool Matches(string? savedHash, string requestHash) =>
        !string.IsNullOrEmpty(savedHash) && CryptographicOperations.FixedTimeEquals(
            Encoding.ASCII.GetBytes(savedHash), Encoding.ASCII.GetBytes(requestHash));
}
