using System.Net;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Security.Authentication;
using System.Text.Json;

namespace Majora.WebApi;

public sealed record AiFailure(string Code, string Message, bool Retryable, int? UpstreamStatus = null);

public static class AiProviders
{
    public static string Kind(Uri endpoint) => endpoint.Host.Equals("generativelanguage.googleapis.com", StringComparison.OrdinalIgnoreCase)
        ? endpoint.AbsolutePath.EndsWith(":generateContent", StringComparison.Ordinal) ? "gemini-native" : "gemini-openai"
        : "openai-compatible";

    public static string? ValidateEndpoint(Uri endpoint, string model)
    {
        if (Kind(endpoint) != "gemini-native") return null;
        var expected = $"/models/{model}:generateContent";
        return Uri.UnescapeDataString(endpoint.AbsolutePath).EndsWith(expected, StringComparison.Ordinal)
            ? null : "نشانی Gemini Native باید به مدل انتخابی و ‎:generateContent ختم شود.";
    }

    public static HttpRequestMessage CreateRequest(Uri endpoint, string key, string model, string instruction, string prompt, int maxTokens)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
        if (Kind(endpoint) == "gemini-native")
        {
            request.Headers.Add("x-goog-api-key", key);
            request.Content = JsonContent.Create(new
            {
                system_instruction = new { parts = new[] { new { text = instruction } } },
                contents = new[] { new { role = "user", parts = new[] { new { text = prompt } } } },
                generationConfig = new { maxOutputTokens = maxTokens, temperature = 0.2 }
            });
        }
        else
        {
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", key);
            request.Content = JsonContent.Create(new { model, temperature = 0.2, max_tokens = maxTokens,
                messages = new[] { new { role = "system", content = instruction }, new { role = "user", content = prompt } } });
        }
        return request;
    }

    public static string ReadAnswer(JsonElement root, Uri endpoint)
    {
        var text = Kind(endpoint) == "gemini-native"
            ? root.GetProperty("candidates")[0].GetProperty("content").GetProperty("parts")[0].GetProperty("text").GetString()
            : root.GetProperty("choices")[0].GetProperty("message").GetProperty("content").GetString();
        if (string.IsNullOrWhiteSpace(text)) throw new JsonException("AI response has no text");
        return text;
    }

    public static AiFailure FromStatus(HttpStatusCode status) => (int)status switch
    {
        400 => new("invalid_request", "درخواست برای سرویس تحلیل پذیرفته نشد؛ تنظیمات مدل و قالب API را بررسی کنید.", false, 400),
        401 => new("invalid_key", "کلید API نامعتبر یا منقضی است؛ مدیر ماژورا باید کلید را تعویض کند.", false, 401),
        403 => new("access_denied", "دسترسی این کلید به مدل، منطقه یا پروژه مجاز نیست.", false, 403),
        404 => new("model_or_endpoint_not_found", "مدل یا نشانی API پیدا نشد؛ آدرس و شناسهٔ مدل را بررسی کنید.", false, 404),
        429 => new("rate_or_quota_limit", "سقف مصرف یا محدودیت نرخ سرویس تحلیل پر شده است؛ کمی بعد دوباره تلاش کنید.", true, 429),
        500 or 502 or 503 => new("provider_unavailable", "سرویس تحلیل موقتاً در دسترس نیست؛ بعداً دوباره تلاش کنید.", true, (int)status),
        504 => new("provider_timeout", "زمان پاسخ سرویس تحلیل تمام شد؛ بعداً دوباره تلاش کنید.", true, 504),
        _ => new("provider_error", "سرویس تحلیل درخواست را نپذیرفت؛ وضعیت اتصال را در پنل ماژورا بررسی کنید.", false, (int)status)
    };

    public static AiFailure FromException(Exception error) => error switch
    {
        TaskCanceledException => new("timeout", "زمان اتصال به سرویس تحلیل تمام شد.", true),
        HttpRequestException { InnerException: SocketException } => new("dns_or_network", "نشانی سرویس تحلیل در شبکه پیدا نشد یا اتصال برقرار نشد.", true),
        HttpRequestException { InnerException: AuthenticationException } => new("tls_error", "اتصال امن به سرویس تحلیل برقرار نشد؛ گواهی TLS را بررسی کنید.", false),
        HttpRequestException => new("network_error", "ارتباط شبکه با سرویس تحلیل برقرار نشد.", true),
        JsonException or KeyNotFoundException or ArgumentOutOfRangeException => new("invalid_response", "ساختار پاسخ سرویس تحلیل معتبر نیست؛ نوع API را بررسی کنید.", false),
        _ => new("provider_error", "سرویس تحلیل پاسخ قابل استفاده نداد.", false)
    };
}
