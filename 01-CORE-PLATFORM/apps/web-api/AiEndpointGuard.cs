using System.Net;
using System.Net.Sockets;

namespace Majora.WebApi;

// AI requests may contain business summaries and an API key. Keep destinations public and HTTPS.
public static class AiEndpointGuard
{
    public static bool ValidUri(string? endpoint, out Uri? uri)
    {
        uri = null;
        if (string.IsNullOrWhiteSpace(endpoint) || endpoint.Length > 500 ||
            !Uri.TryCreate(endpoint, UriKind.Absolute, out var parsed) ||
            parsed.Scheme != Uri.UriSchemeHttps || !string.IsNullOrEmpty(parsed.UserInfo) ||
            !string.IsNullOrEmpty(parsed.Fragment) || !string.IsNullOrEmpty(parsed.Query) ||
            IPAddress.TryParse(parsed.DnsSafeHost, out _)) return false;
        var host = parsed.DnsSafeHost.TrimEnd('.');
        if (host.Length < 4 || host.Equals("localhost", StringComparison.OrdinalIgnoreCase) ||
            host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase) ||
            host.EndsWith(".local", StringComparison.OrdinalIgnoreCase) ||
            host.EndsWith(".internal", StringComparison.OrdinalIgnoreCase)) return false;
        uri = parsed;
        return true;
    }

    public static bool IsPublic(IPAddress address)
    {
        if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
        if (IPAddress.IsLoopback(address)) return false;
        var bytes = address.GetAddressBytes();
        if (address.AddressFamily == AddressFamily.InterNetwork)
            return bytes[0] != 0 && bytes[0] != 10 && bytes[0] != 127 && bytes[0] < 224 &&
                !(bytes[0] == 100 && bytes[1] is >= 64 and <= 127) &&
                !(bytes[0] == 169 && bytes[1] == 254) &&
                !(bytes[0] == 172 && bytes[1] is >= 16 and <= 31) &&
                !(bytes[0] == 192 && bytes[1] == 168) &&
                !(bytes[0] == 192 && bytes[1] == 0) &&
                !(bytes[0] == 198 && bytes[1] is 18 or 19);
        return address.AddressFamily == AddressFamily.InterNetworkV6 &&
            !address.IsIPv6LinkLocal && !address.IsIPv6SiteLocal && !address.IsIPv6Multicast &&
            !address.Equals(IPAddress.IPv6Any) && (bytes[0] & 0xfe) != 0xfc &&
            !(bytes[0] == 0xfe && (bytes[1] & 0xc0) == 0x80);
    }

    public static async ValueTask<Stream> ConnectPublicAsync(SocketsHttpConnectionContext context, CancellationToken cancellationToken)
    {
        var addresses = await Dns.GetHostAddressesAsync(context.DnsEndPoint.Host, cancellationToken);
        foreach (var address in addresses.Where(IsPublic))
        {
            var socket = new Socket(address.AddressFamily, SocketType.Stream, ProtocolType.Tcp);
            try
            {
                await socket.ConnectAsync(new IPEndPoint(address, context.DnsEndPoint.Port), cancellationToken);
                return new NetworkStream(socket, ownsSocket: true);
            }
            catch (Exception ex) when (ex is SocketException or OperationCanceledException)
            {
                socket.Dispose();
                if (ex is OperationCanceledException) throw;
            }
        }
        throw new HttpRequestException("AI provider destination is not a reachable public address.");
    }
}
