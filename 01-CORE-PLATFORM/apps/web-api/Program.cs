using System.Data;
using System.Net;
using System.Security.Claims;
using System.Text.Json;
using System.Net.Http.Json;
using System.Numerics;
using System.Text;
using System.Diagnostics;
using System.Threading.RateLimiting;
using Majora.WebApi;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
var provider = builder.Configuration["Database:Provider"] ?? "Sqlite";
if (!builder.Environment.IsDevelopment() && !provider.Equals("SqlServer", StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException("Production requires Database:Provider=SqlServer.");
var dataProtection = builder.Services.AddDataProtection().SetApplicationName("MajoraWeb");
if (!builder.Environment.IsDevelopment())
{
    var keyDir = builder.Configuration["MAJORA_KEYS_DIRECTORY"];
    if (string.IsNullOrWhiteSpace(keyDir)) throw new InvalidOperationException("MAJORA_KEYS_DIRECTORY is required in Production.");
    Directory.CreateDirectory(keyDir);
    dataProtection.PersistKeysToFileSystem(new DirectoryInfo(keyDir));
}
builder.Services.AddDbContext<MajoraDb>(options =>
{
    if (provider.Equals("SqlServer", StringComparison.OrdinalIgnoreCase))
        options.UseSqlServer(builder.Configuration.GetConnectionString("SqlServer") ?? throw new InvalidOperationException("ConnectionStrings:SqlServer is required"));
    else if (provider.Equals("Sqlite", StringComparison.OrdinalIgnoreCase))
        options.UseSqlite(builder.Configuration.GetConnectionString("Sqlite") ?? "Data Source=majora-dev.db");
    else throw new InvalidOperationException("Unsupported database provider");
});
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(o =>
{
    o.Cookie.Name = "majora.sid"; o.Cookie.HttpOnly = true; o.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
    o.Cookie.SameSite = SameSiteMode.Strict; o.ExpireTimeSpan = TimeSpan.FromHours(12); o.SlidingExpiration = true;
    o.Events.OnRedirectToLogin = c => { c.Response.StatusCode = 401; return Task.CompletedTask; };
    o.Events.OnRedirectToAccessDenied = c => { c.Response.StatusCode = 403; return Task.CompletedTask; };
}).AddCookie("MajoraAdmin", o =>
{
    o.Cookie.Name = "majora.admin.sid"; o.Cookie.HttpOnly = true; o.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
    o.Cookie.SameSite = SameSiteMode.Strict; o.ExpireTimeSpan = TimeSpan.FromHours(12); o.SlidingExpiration = true;
    o.Events.OnRedirectToLogin = c => { c.Response.StatusCode = 401; return Task.CompletedTask; };
    o.Events.OnRedirectToAccessDenied = c => { c.Response.StatusCode = 403; return Task.CompletedTask; };
});
builder.Services.AddAuthorization();
builder.Services.AddRateLimiter(o => o.AddPolicy("login", context => RateLimitPartition.GetFixedWindowLimiter(
    context.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions
    { PermitLimit = 15, Window = TimeSpan.FromMinutes(5), QueueLimit = 0 })));
builder.Services.AddScoped<IPasswordHasher<AppUser>, PasswordHasher<AppUser>>();
builder.Services.AddHttpClient();
builder.Services.AddHttpClient("ai", client => client.Timeout = TimeSpan.FromSeconds(25))
    .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { AllowAutoRedirect = false, UseProxy = false, ConnectCallback = AiEndpointGuard.ConnectPublicAsync });
var app = builder.Build();
if (!app.Environment.IsDevelopment() && builder.Configuration["MAJORA_TRUSTED_PROXY_IP"] is string proxyIp)
{
    if (!IPAddress.TryParse(proxyIp, out var trustedProxy)) throw new InvalidOperationException("MAJORA_TRUSTED_PROXY_IP must be an IP address.");
    app.UseForwardedHeaders(new ForwardedHeadersOptions
    {
        ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
        KnownProxies = { trustedProxy }
    });
}
if (!app.Environment.IsDevelopment()) { app.UseHsts(); app.UseHttpsRedirection(); }
app.UseDefaultFiles(); app.UseStaticFiles();
app.Use(async (ctx, next) =>
{
    if (!ctx.Request.Path.StartsWithSegments("/api")) { await next(); return; }
    ctx.Response.Headers["X-Correlation-ID"] = ctx.TraceIdentifier;
    await next();
    if (!ctx.Response.HasStarted && string.IsNullOrEmpty(ctx.Response.ContentType) &&
        ctx.Response.StatusCode is 401 or 403 or 404)
    {
        var status = ctx.Response.StatusCode;
        ctx.Response.StatusCode = status;
        await ctx.Response.WriteAsJsonAsync(new {
            errorCode = status == 401 ? "authentication_required" : status == 403 ? "access_denied" : "not_found",
            message = status == 401 ? "نشست ورود معتبر نیست؛ دوباره وارد شوید." :
                status == 403 ? "برای این عملیات دسترسی ندارید." : "مسیر یا مورد درخواستی پیدا نشد.",
            correlationId = ctx.TraceIdentifier
        });
    }
});
app.UseRateLimiter(); app.UseAuthentication(); app.UseAuthorization();

app.Use(async (ctx, next) =>
{
    if (ctx.User.Identity?.IsAuthenticated == true && ctx.Request.Path.StartsWithSegments("/api") &&
        !ctx.Request.Path.StartsWithSegments("/api/auth"))
    {
        var db = ctx.RequestServices.GetRequiredService<MajoraDb>();
        var id = Guid.Parse(ctx.User.FindFirstValue(ClaimTypes.NameIdentifier)!);
        var account = await db.Users.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id);
        if (account is null || !account.Enabled || account.Role != ctx.User.FindFirstValue(ClaimTypes.Role) || account.TenantId?.ToString() != ctx.User.FindFirstValue("tenant") || account.AuthVersion.ToString() != ctx.User.FindFirstValue("authVersion"))
        { await ctx.SignOutAsync(); ctx.Response.StatusCode = 401; return; }
    }
    await next();
});

// A separate readable token protects cookie-authenticated mutations against CSRF.
app.Use(async (ctx, next) =>
{
    if (ctx.Request.Path.StartsWithSegments("/api") && ctx.Request.Method is not ("GET" or "HEAD" or "OPTIONS"))
    {
        if (ctx.Request.Path != "/api/auth/login")
        {
            var panel = ctx.Request.Path.StartsWithSegments("/api/admin") ||
                ctx.Request.Path.StartsWithSegments("/api/auth") && ctx.Request.Headers["X-Majora-Panel"] == "admin"
                ? "admin" : "merchant";
            var cookie = ctx.Request.Cookies[panel == "admin" ? "majora.admin.csrf" : "majora.csrf"];
            if (string.IsNullOrEmpty(cookie) || cookie != ctx.Request.Headers["X-CSRF"].ToString())
            { ctx.Response.StatusCode = 400; await ctx.Response.WriteAsJsonAsync(new { error = "توکن امنیتی درخواست نامعتبر است." }); return; }
        }
    }
    await next();
});

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<MajoraDb>();
    if (app.Environment.IsDevelopment() && provider.Equals("Sqlite", StringComparison.OrdinalIgnoreCase))
    {
        await db.Database.EnsureCreatedAsync();
        // Local installations predate EF migrations. Add the one additive column
        // without recreating or replacing a merchant's SQLite data file.
        var connection = db.Database.GetDbConnection();
        var openedHere = connection.State != ConnectionState.Open;
        if (openedHere) await connection.OpenAsync();
        try
        {
            using var columns = connection.CreateCommand();
            columns.CommandText = "PRAGMA table_info(InvoiceBrands)";
            using var reader = await columns.ExecuteReaderAsync();
            var hasSocialLinks = false;
            while (await reader.ReadAsync())
                if (string.Equals(reader.GetString(1), "SocialLinksJson", StringComparison.OrdinalIgnoreCase)) hasSocialLinks = true;
            await reader.CloseAsync();
            if (!hasSocialLinks)
            {
                using var upgrade = connection.CreateCommand();
                upgrade.CommandText = "ALTER TABLE InvoiceBrands ADD COLUMN SocialLinksJson TEXT NOT NULL DEFAULT '[]'";
                await upgrade.ExecuteNonQueryAsync();
            }
        }
        finally { if (openedHere) await connection.CloseAsync(); }
    }
    else if (app.Environment.IsDevelopment()) await db.Database.MigrateAsync();
    else if (!await db.Database.CanConnectAsync() || (await db.Database.GetPendingMigrationsAsync()).Any())
        throw new InvalidOperationException("SQL Server is unavailable or schema migrations are pending. Apply the reviewed release migration before startup.");
    var adminName = builder.Configuration["MAJORA_BOOTSTRAP_USER"];
    var adminPassword = builder.Configuration["MAJORA_BOOTSTRAP_PASSWORD"];
    if (!string.IsNullOrWhiteSpace(adminName) && !string.IsNullOrWhiteSpace(adminPassword) && !await db.Users.AnyAsync())
    {
        var user = new AppUser { Username = adminName.Trim(), DisplayName = "مدیر ماژورا", Role = "platform_admin" };
        user.PasswordHash = scope.ServiceProvider.GetRequiredService<IPasswordHasher<AppUser>>().HashPassword(user, adminPassword);
        db.Users.Add(user); await db.SaveChangesAsync();
    }
}

static Guid UserId(ClaimsPrincipal p) => Guid.Parse(p.FindFirstValue(ClaimTypes.NameIdentifier)!);
static Guid TenantId(ClaimsPrincipal p) => Guid.Parse(p.FindFirstValue("tenant")!);
static string Role(ClaimsPrincipal p) => p.FindFirstValue(ClaimTypes.Role) ?? "";
static bool CanWrite(ClaimsPrincipal p) => Role(p) is "owner" or "manager";
static bool CanSell(ClaimsPrincipal p) => Role(p) is "owner" or "manager" or "staff";
static IResult Fail(string message, int status = 400) => Results.Json(new {
    errorCode = status == 409 ? "conflict" : status == 403 ? "access_denied" : status == 401 ? "authentication_required" : "invalid_request",
    error = message
}, statusCode: status);
static void Audit(MajoraDb db, ClaimsPrincipal p, Guid? tenantId, string action, string entity, Guid id, string detail = "") => db.Audit.Add(new AuditEntry { ActorId = UserId(p), TenantId = tenantId, Action = action, EntityType = entity, EntityId = id.ToString(), Detail = detail });
static long DiscountedPrice(long price, decimal percent) => checked(price - (long)decimal.Round(price * percent / 100m, 0, MidpointRounding.AwayFromZero));
static bool ValidCheque(ChequeRequest body) =>
    body.Direction is "received" or "issued" && !string.IsNullOrWhiteSpace(body.Party) && body.Party.Trim().Length <= 200 &&
    !string.IsNullOrWhiteSpace(body.Serial) && body.Serial.Trim().Length <= 80 &&
    !string.IsNullOrWhiteSpace(body.Bank) && body.Bank.Trim().Length <= 120 &&
    body.AmountRial > 0 && body.DueAt.Year is >= 1900 and <= 2100 &&
    body.RegistrationStatus is "unknown" or "unregistered" or "registered" or "confirmed" &&
    (string.IsNullOrEmpty(body.SayadId) || body.SayadId.Length == 16 && body.SayadId.All(char.IsAsciiDigit)) &&
    (string.IsNullOrEmpty(body.IssuerNationalId) || body.IssuerNationalId.Length == 10 && body.IssuerNationalId.All(char.IsAsciiDigit)) &&
    (string.IsNullOrEmpty(body.BeneficiaryNationalId) || body.BeneficiaryNationalId.Length == 10 && body.BeneficiaryNationalId.All(char.IsAsciiDigit)) &&
    (body.Note?.Length ?? 0) <= 500;
static Cheque NewCheque(ChequeRequest body, Guid tid, Guid? invoiceId = null) => new()
{
    TenantId = tid, InvoiceId = invoiceId, Direction = body.Direction, Party = body.Party.Trim(), Serial = body.Serial.Trim(),
    Bank = body.Bank.Trim(), AmountRial = body.AmountRial, DueAt = body.DueAt.ToUniversalTime(),
    SayadId = body.SayadId?.Trim() ?? "", IssuerNationalId = body.IssuerNationalId?.Trim() ?? "",
    BeneficiaryNationalId = body.BeneficiaryNationalId?.Trim() ?? "", RegistrationStatus = body.RegistrationStatus,
    Note = body.Note?.Trim() ?? "", ShowDetails = body.ShowDetails, ShowImage = body.ShowImage
};
static async Task<bool> Active(MajoraDb db, Guid tenantId) => await db.Tenants.AnyAsync(t => t.Id == tenantId && t.Enabled) && await db.Subscriptions.AnyAsync(s => s.TenantId == tenantId && s.PaymentStatus == "paid" && s.StartsAt <= DateTime.UtcNow && s.EndsAt > DateTime.UtcNow);
static string AuthScheme(string panel) => panel == "admin" ? "MajoraAdmin" : CookieAuthenticationDefaults.AuthenticationScheme;
static void Csrf(HttpContext c, string panel)
{
    var token = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(24));
    c.Response.Cookies.Append(panel == "admin" ? "majora.admin.csrf" : "majora.csrf", token,
        new CookieOptions { HttpOnly = false, Secure = !c.RequestServices.GetRequiredService<IHostEnvironment>().IsDevelopment() || c.Request.IsHttps,
            SameSite = SameSiteMode.Strict, Path = "/" });
}
static async Task<AppUser?> AuthenticatedAccount(MajoraDb db, HttpContext c, string panel)
{
    var scheme = AuthScheme(panel);
    var ticket = await c.AuthenticateAsync(scheme);
    var principal = ticket.Principal;
    if (!ticket.Succeeded || principal is null || !Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var id)) return null;
    var user = await db.Users.FindAsync(id);
    if (user is null || !user.Enabled || user.Role != principal.FindFirstValue(ClaimTypes.Role) ||
        user.AuthVersion.ToString() != principal.FindFirstValue("authVersion") ||
        user.TenantId?.ToString() != principal.FindFirstValue("tenant") ||
        panel == "admin" && user.Role != "platform_admin" ||
        panel == "merchant" && user.TenantId is null)
    { await c.SignOutAsync(scheme); return null; }
    c.User = principal;
    return user;
}

app.MapGet("/api/health", () => Results.Ok(new { status = "ok", version = "web-foundation-1" }));
app.MapPost("/api/auth/login", async (LoginRequest body, MajoraDb db, IPasswordHasher<AppUser> hasher, HttpContext ctx) =>
{
    if (string.IsNullOrWhiteSpace(body.Username) || string.IsNullOrWhiteSpace(body.Password)) return Fail("نام کاربری یا رمز عبور نادرست است.", 401);
    var user = await db.Users.SingleOrDefaultAsync(x => x.Username == body.Username && x.Enabled);
    if (user is null || hasher.VerifyHashedPassword(user, user.PasswordHash, body.Password) == PasswordVerificationResult.Failed) return Fail("نام کاربری یا رمز عبور نادرست است.", 401);
    if (user.TenantId is Guid tid && !await Active(db, tid)) return Fail("اشتراک این کسب‌وکار فعال نیست. با پشتیبانی ماژورا تماس بگیرید.", 403);
    var panel = user.Role == "platform_admin" ? "admin" : "merchant";
    var scheme = AuthScheme(panel);
    var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, user.Id.ToString()), new(ClaimTypes.Name, user.DisplayName), new(ClaimTypes.Role, user.Role), new("authVersion", user.AuthVersion.ToString()) };
    if (user.TenantId is Guid tenantId) claims.Add(new Claim("tenant", tenantId.ToString()));
    await ctx.SignInAsync(scheme, new ClaimsPrincipal(new ClaimsIdentity(claims, scheme)));
    Csrf(ctx, panel);
    return Results.Ok(new { user.Id, user.DisplayName, user.Role, user.TenantId });
}).RequireRateLimiting("login");
app.MapPost("/api/auth/logout", async (MajoraDb db, HttpContext c) =>
{
    var panel = c.Request.Headers["X-Majora-Panel"].ToString() == "admin" ? "admin" : "merchant";
    if (await AuthenticatedAccount(db, c, panel) is null) return Results.Unauthorized();
    await c.SignOutAsync(AuthScheme(panel));
    c.Response.Cookies.Delete(panel == "admin" ? "majora.admin.csrf" : "majora.csrf");
    return Results.NoContent();
});
app.MapGet("/api/auth/me", async (string? panel, MajoraDb db, HttpContext c) =>
{
    panel = panel == "admin" ? "admin" : "merchant";
    var user = await AuthenticatedAccount(db, c, panel);
    if (user is null) return Results.Unauthorized();
    Csrf(c, panel);
    return Results.Ok(new { user.Id, user.DisplayName, user.Role, user.TenantId });
});
app.MapPost("/api/auth/change-password", async (PasswordChange body, MajoraDb db, IPasswordHasher<AppUser> hasher, HttpContext c) =>
{
    var panel = c.Request.Headers["X-Majora-Panel"].ToString() == "admin" ? "admin" : "merchant";
    var user = await AuthenticatedAccount(db, c, panel); if (user is null) return Results.Unauthorized();
    if (body.NewPassword.Length < 12 || hasher.VerifyHashedPassword(user, user.PasswordHash, body.CurrentPassword) == PasswordVerificationResult.Failed) return Fail("رمز فعلی نادرست است یا رمز جدید کمتر از ۱۲ نویسه دارد.");
    user.PasswordHash = hasher.HashPassword(user, body.NewPassword); user.AuthVersion++;
    Audit(db, c.User, user.TenantId, "password.change", "user", user.Id); await db.SaveChangesAsync(); await c.SignOutAsync(AuthScheme(panel)); return Results.NoContent();
});

var admin = app.MapGroup("/api/admin").RequireAuthorization(p => p.AddAuthenticationSchemes("MajoraAdmin").RequireRole("platform_admin"));
admin.MapGet("/overview", async (MajoraDb db) =>
{
    var now = DateTime.UtcNow;
    return Results.Ok(new {
        tenants = await db.Tenants.CountAsync(),
        activeSubscriptions = await db.Tenants.CountAsync(t => t.Enabled && db.Subscriptions.Any(s =>
            s.TenantId == t.Id && s.PaymentStatus == "paid" && s.StartsAt <= now && s.EndsAt > now)),
        users = await db.Users.CountAsync()
    });
});
admin.MapGet("/ai-provider", async (MajoraDb db, IConfiguration config) =>
{
    var profile = await db.AiProviderProfiles.AsNoTracking().SingleOrDefaultAsync(x => x.Id == 1);
    return Results.Ok(profile is null
        ? new { enabled = !string.IsNullOrWhiteSpace(config["MAJORA_AI_API_KEY"]), endpoint = config["MAJORA_AI_ENDPOINT"] ?? "", model = config["MAJORA_AI_MODEL"] ?? "", hasApiKey = !string.IsNullOrWhiteSpace(config["MAJORA_AI_API_KEY"]), source = "server" }
        : new { enabled = profile.Enabled, endpoint = profile.Endpoint, model = profile.Model, hasApiKey = !string.IsNullOrWhiteSpace(profile.ProtectedApiKey), source = "panel" });
});
admin.MapPut("/ai-provider", async (AiProviderRequest body, MajoraDb db, IDataProtectionProvider protection, HttpContext c) =>
{
    if (!AiEndpointGuard.ValidUri(body.Endpoint, out var endpointUri) || string.IsNullOrWhiteSpace(body.Model) || body.Model.Length > 120 || body.ApiKey?.Length > 1000)
        return Fail("نشانی HTTPS یا نام مدل نامعتبر است.");
    if (AiProviders.ValidateEndpoint(endpointUri!, body.Model) is { } endpointError) return Fail(endpointError);
    var profile = await db.AiProviderProfiles.SingleOrDefaultAsync(x => x.Id == 1);
    if (body.Enabled && string.IsNullOrWhiteSpace(body.ApiKey) && string.IsNullOrWhiteSpace(profile?.ProtectedApiKey))
        return Fail("برای فعال‌سازی، کلید API لازم است.");
    if (profile is null) { profile = new AiProviderProfile(); db.AiProviderProfiles.Add(profile); }
    profile.Endpoint = body.Endpoint.Trim(); profile.Model = body.Model.Trim(); profile.Enabled = body.Enabled; profile.UpdatedAt = DateTime.UtcNow;
    if (!string.IsNullOrWhiteSpace(body.ApiKey)) profile.ProtectedApiKey = protection.CreateProtector("ai-provider-key-v1").Protect(body.ApiKey.Trim());
    Audit(db, c.User, null, "ai-provider.update", "ai-provider", Guid.Empty, $"enabled={body.Enabled};model={profile.Model}");
    await db.SaveChangesAsync();
    return Results.Ok(new { profile.Enabled, profile.Endpoint, profile.Model, hasApiKey = !string.IsNullOrWhiteSpace(profile.ProtectedApiKey), source = "panel" });
});
admin.MapPost("/ai-provider/test", async (MajoraDb db, IDataProtectionProvider protection, IConfiguration config, IHttpClientFactory clients, HttpContext c) =>
{
    var profile = await db.AiProviderProfiles.AsNoTracking().SingleOrDefaultAsync(x => x.Id == 1);
    var endpoint = profile?.Endpoint ?? config["MAJORA_AI_ENDPOINT"];
    var model = profile?.Model ?? config["MAJORA_AI_MODEL"];
    string? key;
    try { key = profile is null ? config["MAJORA_AI_API_KEY"] : protection.CreateProtector("ai-provider-key-v1").Unprotect(profile.ProtectedApiKey); }
    catch (System.Security.Cryptography.CryptographicException) { return Results.Ok(new { success = false, errorCode = "key_unavailable", message = "کلید ذخیره‌شده قابل بازیابی نیست؛ آن را دوباره ثبت کنید.", correlationId = c.TraceIdentifier }); }
    if (string.IsNullOrWhiteSpace(key) || string.IsNullOrWhiteSpace(model) || !AiEndpointGuard.ValidUri(endpoint, out var uri))
        return Results.Ok(new { success = false, errorCode = "configuration_missing", message = "نشانی HTTPS، مدل یا کلید API تنظیم نشده است.", correlationId = c.TraceIdentifier });
    var endpointError = AiProviders.ValidateEndpoint(uri!, model);
    if (endpointError is not null) return Results.Ok(new { success = false, errorCode = "model_endpoint_mismatch", message = endpointError, correlationId = c.TraceIdentifier });
    var watch = Stopwatch.StartNew();
    using var request = AiProviders.CreateRequest(uri!, key, model, "فقط یک پاسخ کوتاه فارسی بده.", "سلام؛ فقط بنویس آماده‌ام.", 30);
    try
    {
        using var response = await clients.CreateClient("ai").SendAsync(request, c.RequestAborted);
        if (!response.IsSuccessStatusCode)
        {
            var failure = AiProviders.FromStatus(response.StatusCode);
            return Results.Ok(new { success = false, errorCode = failure.Code, message = failure.Message,
                upstreamStatus = failure.UpstreamStatus, retryable = failure.Retryable,
                latencyMs = watch.ElapsedMilliseconds, correlationId = c.TraceIdentifier });
        }
        using var doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(c.RequestAborted), cancellationToken: c.RequestAborted);
        _ = AiProviders.ReadAnswer(doc.RootElement, uri!);
        return Results.Ok(new { success = true, provider = AiProviders.Kind(uri!), latencyMs = watch.ElapsedMilliseconds,
            correlationId = c.TraceIdentifier });
    }
    catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or KeyNotFoundException or JsonException or ArgumentOutOfRangeException)
    {
        var failure = AiProviders.FromException(ex);
        return Results.Ok(new { success = false, errorCode = failure.Code, message = failure.Message,
            retryable = failure.Retryable, latencyMs = watch.ElapsedMilliseconds, correlationId = c.TraceIdentifier });
    }
}).RequireRateLimiting("login");
admin.MapGet("/plans", async (MajoraDb db) => Results.Ok(await db.Plans.OrderBy(x => x.MonthlyRial).ToListAsync()));
admin.MapPost("/plans", async (PlanRequest body, MajoraDb db, HttpContext c) =>
{
    if (string.IsNullOrWhiteSpace(body.Name) || body.MonthlyRial < 0 || body.MaxUsers < 1 ||
        (body.Description?.Length ?? 0) > 500 || (body.Features?.Count ?? 0) > 20 ||
        body.Features?.Any(x => string.IsNullOrWhiteSpace(x) || x.Length > 150) == true) return Fail("مشخصات طرح نامعتبر است.");
    var plan = new Plan { Name = body.Name.Trim(), Description = body.Description?.Trim() ?? "",
        FeaturesJson = JsonSerializer.Serialize(body.Features?.Select(x => x.Trim()).ToArray() ?? []),
        MonthlyRial = body.MonthlyRial, MaxUsers = body.MaxUsers, Enabled = body.Enabled };
    db.Plans.Add(plan); Audit(db, c.User, null, "plan.create", "plan", plan.Id); await db.SaveChangesAsync(); return Results.Created($"/api/admin/plans/{plan.Id}", plan);
});
admin.MapPut("/plans/{id:guid}", async (Guid id, PlanRequest body, MajoraDb db, HttpContext c) =>
{
    var plan = await db.Plans.FindAsync(id); if (plan is null) return Results.NotFound();
    if (string.IsNullOrWhiteSpace(body.Name) || body.MonthlyRial < 0 || body.MaxUsers < 1 ||
        (body.Description?.Length ?? 0) > 500 || (body.Features?.Count ?? 0) > 20 ||
        body.Features?.Any(x => string.IsNullOrWhiteSpace(x) || x.Length > 150) == true) return Fail("مشخصات طرح نامعتبر است.");
    plan.Name = body.Name.Trim(); plan.Description = body.Description?.Trim() ?? "";
    plan.FeaturesJson = JsonSerializer.Serialize(body.Features?.Select(x => x.Trim()).ToArray() ?? []);
    plan.MonthlyRial = body.MonthlyRial; plan.MaxUsers = body.MaxUsers; plan.Enabled = body.Enabled;
    Audit(db, c.User, null, "plan.update", "plan", id); await db.SaveChangesAsync(); return Results.Ok(plan);
});
admin.MapGet("/promo-codes", async (MajoraDb db) => Results.Ok(await db.PromoCodes.AsNoTracking().OrderByDescending(x => x.ExpiresAt).ToListAsync()));
admin.MapPost("/promo-codes", async (PromoCodeRequest body, MajoraDb db, HttpContext c) =>
{
    var code = body.Code?.Trim().ToUpperInvariant();
    if (string.IsNullOrWhiteSpace(code) || !System.Text.RegularExpressions.Regex.IsMatch(code, "^[A-Z0-9_-]{3,40}$") ||
        body.Percent <= 0 || body.Percent > 100 || body.ExpiresAt <= body.StartsAt)
        return Fail("کد، درصد یا بازهٔ اعتبار تخفیف نامعتبر است.");
    if (await db.PromoCodes.AnyAsync(x => x.Code == code)) return Fail("کد تخفیف تکراری است.", 409);
    var promo = new PromoCode { Code = code, Percent = body.Percent, StartsAt = body.StartsAt.ToUniversalTime(),
        ExpiresAt = body.ExpiresAt.ToUniversalTime(), Enabled = body.Enabled };
    db.PromoCodes.Add(promo); Audit(db, c.User, null, "promo.create", "promo", promo.Id);
    try { await db.SaveChangesAsync(); } catch (DbUpdateException) { return Fail("کد تخفیف تکراری است.", 409); }
    return Results.Created($"/api/admin/promo-codes/{promo.Id}", promo);
});
admin.MapPut("/promo-codes/{id:guid}", async (Guid id, PromoCodeRequest body, MajoraDb db, HttpContext c) =>
{
    var promo = await db.PromoCodes.SingleOrDefaultAsync(x => x.Id == id); if (promo is null) return Results.NotFound();
    var code = body.Code?.Trim().ToUpperInvariant();
    if (string.IsNullOrWhiteSpace(code) || !System.Text.RegularExpressions.Regex.IsMatch(code, "^[A-Z0-9_-]{3,40}$") ||
        body.Percent <= 0 || body.Percent > 100 || body.ExpiresAt <= body.StartsAt) return Fail("کد یا بازهٔ تخفیف نامعتبر است.");
    if (await db.PromoCodes.AnyAsync(x => x.Code == code && x.Id != id)) return Fail("کد تخفیف تکراری است.", 409);
    promo.Code = code; promo.Percent = body.Percent; promo.StartsAt = body.StartsAt.ToUniversalTime();
    promo.ExpiresAt = body.ExpiresAt.ToUniversalTime(); promo.Enabled = body.Enabled;
    Audit(db, c.User, null, "promo.update", "promo", id);
    try { await db.SaveChangesAsync(); } catch (DbUpdateException) { return Fail("کد تخفیف تکراری است.", 409); }
    return Results.Ok(promo);
});
admin.MapGet("/billing", async (MajoraDb db) => Results.Ok(await db.PlatformBilling.AsNoTracking().SingleOrDefaultAsync(x => x.Id == 1)
    ?? new PlatformBilling()));
admin.MapPut("/billing", async (BillingRequest body, MajoraDb db, HttpContext c) =>
{
    var number = new string((body.CardNumber ?? "").Where(char.IsAsciiDigit).ToArray());
    if (number.Length != 16 || string.IsNullOrWhiteSpace(body.CardHolder) || body.CardHolder.Length > 120)
        return Fail("شماره کارت یا نام دارنده معتبر نیست.");
    var billing = await db.PlatformBilling.SingleOrDefaultAsync(x => x.Id == 1);
    if (billing is null) { billing = new PlatformBilling(); db.PlatformBilling.Add(billing); }
    billing.CardNumber = number; billing.CardHolder = body.CardHolder.Trim();
    Audit(db, c.User, null, "billing.update", "billing", Guid.Empty);
    await db.SaveChangesAsync(); return Results.Ok(billing);
});
admin.MapGet("/subscription-orders", async (MajoraDb db) => Results.Ok(await db.SubscriptionOrders.AsNoTracking()
    .OrderByDescending(x => x.CreatedAt).Take(100)
    .Select(x => new { x.Id, x.TenantId, TenantName = db.Tenants.Where(t => t.Id == x.TenantId).Select(t => t.Name).FirstOrDefault(),
        x.PlanNameSnapshot, x.PromoCodeSnapshot, x.BasePriceRial, x.TotalRial, x.Status, x.PaymentMethod,
        HasReceipt = x.ReceiptBytes != null, x.CreatedAt, x.ReviewedAt }).ToListAsync()));
admin.MapGet("/subscription-orders/{id:guid}/receipt", async (Guid id, MajoraDb db, HttpContext c) =>
{
    var order = await db.SubscriptionOrders.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id);
    if (order?.ReceiptBytes is null || order.ReceiptContentType is null) return Results.NotFound();
    c.Response.Headers.XContentTypeOptions = "nosniff";
    c.Response.Headers.CacheControl = "private, no-store";
    return Results.File(order.ReceiptBytes, order.ReceiptContentType);
});
admin.MapPost("/subscription-orders/{id:guid}/decision", async (Guid id, SubscriptionDecision body, MajoraDb db, HttpContext c) =>
{
    if (body.Decision is not ("approve" or "reject")) return Fail("تصمیم تأیید یا رد لازم است.");
    await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
    var order = await db.SubscriptionOrders.SingleOrDefaultAsync(x => x.Id == id);
    if (order is null) return Results.NotFound();
    if (order.Status != "pending_approval") return Fail("این درخواست در انتظار تأیید نیست.", 409);
    order.ReviewedAt = DateTime.UtcNow;
    if (body.Decision == "approve")
    {
        var tenant = await db.Tenants.SingleOrDefaultAsync(x => x.Id == order.TenantId);
        if (tenant is null) return Results.NotFound();
        var latestEnd = await db.Subscriptions.Where(x => x.TenantId == order.TenantId && x.PaymentStatus == "paid")
            .OrderByDescending(x => x.EndsAt).Select(x => (DateTime?)x.EndsAt).FirstOrDefaultAsync();
        var start = latestEnd is DateTime end && end > DateTime.UtcNow ? end : DateTime.UtcNow;
        var sub = new Subscription { TenantId = order.TenantId, PlanId = order.PlanId, StartsAt = start,
            EndsAt = start.AddMonths(1), PaymentStatus = "paid", PriceRialSnapshot = order.TotalRial,
            Note = $"order={order.Id};promo={order.PromoCodeSnapshot}" };
        db.Subscriptions.Add(sub); order.SubscriptionId = sub.Id; order.Status = "paid";
        Audit(db, c.User, order.TenantId, "subscription-order.approve", "subscription-order", id, $"subscription={sub.Id}");
    }
    else { order.Status = "rejected"; Audit(db, c.User, order.TenantId, "subscription-order.reject", "subscription-order", id); }
    await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok(new { order.Id, order.Status, order.SubscriptionId });
});
admin.MapGet("/tenants", async (MajoraDb db) => Results.Ok(await db.Tenants.OrderBy(x => x.Name).Select(x => new { x.Id, x.Name, x.Slug, x.Enabled, x.BrandColor, x.LogoUrl, Subscription = db.Subscriptions.Where(s => s.TenantId == x.Id).OrderByDescending(s => s.EndsAt).Select(s => new { s.EndsAt, s.PaymentStatus, s.PriceRialSnapshot }).FirstOrDefault() }).ToListAsync()));
admin.MapPost("/tenants", async (TenantRequest body, MajoraDb db, IPasswordHasher<AppUser> hasher, IWebHostEnvironment host, HttpContext c) =>
{
    if (string.IsNullOrWhiteSpace(body.Name) || body.Name.Length > 200 || string.IsNullOrWhiteSpace(body.Slug) ||
        !System.Text.RegularExpressions.Regex.IsMatch(body.Slug, "^[a-z0-9-]{3,40}$") ||
        string.IsNullOrWhiteSpace(body.OwnerPassword) || body.OwnerPassword.Length < 12 ||
        string.IsNullOrWhiteSpace(body.OwnerUsername) || body.OwnerUsername.Length > 100 ||
        string.IsNullOrWhiteSpace(body.OwnerName) || body.OwnerName.Length > 200 ||
        body.BrandColor is not null && !System.Text.RegularExpressions.Regex.IsMatch(body.BrandColor, "^#[0-9a-fA-F]{6}$"))
        return Fail("نام، شناسه، رنگ یا رمز مالک نامعتبر است؛ رمز حداقل ۱۲ نویسه باشد.");
    async Task<IResult?> ExistingResult()
    {
        var existing = await db.Tenants.AsNoTracking().SingleOrDefaultAsync(x => x.Slug == body.Slug);
        if (existing is null) return null;
        var owner = await db.Users.AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == existing.Id && x.Role == "owner");
        if (owner?.Username == body.OwnerUsername.Trim() && existing.Name == body.Name.Trim() &&
            hasher.VerifyHashedPassword(owner, owner.PasswordHash, body.OwnerPassword) != PasswordVerificationResult.Failed)
            return Results.Ok(new { existing.Id, existing.Name, existing.Slug });
        return Fail("شناسهٔ فروشگاه یا نام کاربری تکراری است.", 409);
    }
    if (await ExistingResult() is { } repeated) return repeated;
    if (await db.Users.AnyAsync(x => x.Username == body.OwnerUsername.Trim())) return Fail("نام کاربری تکراری است.", 409);
    var tenant = new Tenant { Name = body.Name.Trim(), Slug = body.Slug, BrandColor = body.BrandColor ?? "#0B2B53" };
    var owner = new AppUser { TenantId = tenant.Id, Username = body.OwnerUsername.Trim(), DisplayName = body.OwnerName.Trim(), Role = "owner" };
    owner.PasswordHash = hasher.HashPassword(owner, body.OwnerPassword);
    db.Tenants.Add(tenant); db.Users.Add(owner);
    db.InvoiceBrands.Add(InvoiceBrand.Create(tenant.Id, tenant.Name, body.ClassicPreset, host.WebRootPath));
    Audit(db, c.User, tenant.Id, "tenant.create", "tenant", tenant.Id);
    try { await db.SaveChangesAsync(); }
    catch (DbUpdateException) { db.ChangeTracker.Clear(); return await ExistingResult() ?? Fail("ثبت هم‌زمان فروشگاه رخ داد؛ دوباره تلاش کنید.", 409); }
    return Results.Created($"/api/admin/tenants/{tenant.Id}", new { tenant.Id, tenant.Name, tenant.Slug });
});
admin.MapPut("/tenants/{id:guid}", async (Guid id, TenantUpdate body, MajoraDb db, HttpContext c) =>
{
    var tenant = await db.Tenants.FindAsync(id); if (tenant is null) return Results.NotFound();
    if (string.IsNullOrWhiteSpace(body.Name) || body.Name.Length > 200 ||
        body.BrandColor is not null && !System.Text.RegularExpressions.Regex.IsMatch(body.BrandColor, "^#[0-9a-fA-F]{6}$"))
        return Fail("نام یا رنگ فروشگاه نامعتبر است.");
    if (body.LogoUrl != tenant.LogoUrl) return Fail("لوگوی اصلی را از بخش هویت و قالب فاکتور تغییر دهید.");
    var oldName = tenant.Name; var oldEnabled = tenant.Enabled; var oldColor = tenant.BrandColor;
    tenant.Name = body.Name.Trim(); tenant.Enabled = body.Enabled; tenant.BrandColor = body.BrandColor ?? tenant.BrandColor;
    if (oldName != tenant.Name)
    {
        var profile = await db.InvoiceBrands.SingleOrDefaultAsync(x => x.TenantId == id);
        if (profile is not null) { profile.StoreName = tenant.Name; profile.Revision++; profile.UpdatedAt = DateTime.UtcNow; }
    }
    Audit(db, c.User, id, "tenant.update", "tenant", id,
        JsonSerializer.Serialize(new { oldName, newName = tenant.Name, oldEnabled, newEnabled = tenant.Enabled,
            oldColor, newColor = tenant.BrandColor }));
    await db.SaveChangesAsync(); return Results.Ok(tenant);
});
admin.MapGet("/tenants/{id:guid}/invoice-brand", async (Guid id, MajoraDb db) =>
{
    var tenant = await db.Tenants.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id);
    if (tenant is null) return Results.NotFound();
    var profile = await db.InvoiceBrands.AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == id)
        ?? InvoiceBrand.Create(id, tenant.Name, false, null);
    return Results.Ok(InvoiceBrand.View(profile));
});
admin.MapPut("/tenants/{id:guid}/invoice-brand", async (Guid id, AdminInvoiceBrandUpdate body, MajoraDb db, HttpContext c) =>
{
    if (body.Brand is null || string.IsNullOrWhiteSpace(body.Reason) || body.Reason.Length > 500)
        return Fail("قالب و دلیل تغییر لازم است.");
    var invalid = InvoiceBrand.Validate(body.Brand); if (invalid is not null) return Fail(invalid);
    var tenant = await db.Tenants.SingleOrDefaultAsync(x => x.Id == id); if (tenant is null) return Results.NotFound();
    var profile = await db.InvoiceBrands.SingleOrDefaultAsync(x => x.TenantId == id);
    if (profile is null) { profile = InvoiceBrand.Create(id, tenant.Name, false, null); db.InvoiceBrands.Add(profile); }
    if (profile.Revision != body.Brand.Revision) return Fail("قالب در دستگاه دیگری تغییر کرده است؛ صفحه را تازه کنید.", 409);
    if (string.IsNullOrWhiteSpace(body.Brand.LogoDataUrl))
        return Fail("لوگوی اصلی معتبر لازم است؛ حذف آن بدون جایگزین ممکن نیست.");
    var oldName = profile.StoreName;
    var oldLogoHash = InvoiceBrand.LogoHash(profile.LogoDataUrl);
    InvoiceBrand.Apply(profile, body.Brand);
    tenant.Name = profile.StoreName;
    Audit(db, c.User, id, "invoice-brand.admin-update", "invoice-brand", id,
        JsonSerializer.Serialize(new { oldName, newName = profile.StoreName, oldLogoHash,
            newLogoHash = InvoiceBrand.LogoHash(profile.LogoDataUrl), profile.Revision, reason = body.Reason.Trim() }));
    try { await db.SaveChangesAsync(); }
    catch (DbUpdateConcurrencyException) { return Fail("قالب هم‌زمان تغییر کرده است؛ صفحه را تازه کنید.", 409); }
    catch (DbUpdateException) { return Fail("قالب هم‌زمان ثبت شده است؛ صفحه را تازه کنید.", 409); }
    return Results.Ok(InvoiceBrand.View(profile));
});
admin.MapPost("/tenants/{id:guid}/subscription", async (Guid id, SubscriptionRequest body, MajoraDb db, HttpContext c) =>
{
    if (!await db.Tenants.AnyAsync(x => x.Id == id)) return Results.NotFound();
    var plan = await db.Plans.FindAsync(body.PlanId);
    if (plan is null || !plan.Enabled || body.EndsAt <= body.StartsAt || body.PriceRial < 0 || body.PaymentStatus is not ("paid" or "pending"))
        return Fail("طرح، پرداخت یا بازهٔ اشتراک نامعتبر است.");
    var price = body.PriceRial ?? plan.MonthlyRial;
    await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
    var repeated = await db.Subscriptions.SingleOrDefaultAsync(s => s.TenantId == id && s.PlanId == plan.Id &&
        s.StartsAt == body.StartsAt && s.EndsAt == body.EndsAt);
    if (repeated is not null)
        return repeated.PriceRialSnapshot == price && repeated.PaymentStatus == body.PaymentStatus
            ? Results.Ok(repeated) : Fail("برای همین بازه اشتراک دیگری ثبت شده است.", 409);
    var sub = new Subscription { TenantId = id, PlanId = plan.Id, StartsAt = body.StartsAt, EndsAt = body.EndsAt,
        PriceRialSnapshot = price, PaymentStatus = body.PaymentStatus, Note = body.Note ?? "" };
    db.Subscriptions.Add(sub); Audit(db, c.User, id, "subscription.create", "subscription", sub.Id);
    await db.SaveChangesAsync(); await tx.CommitAsync();
    return Results.Created($"/api/admin/tenants/{id}/subscription", sub);
});
admin.MapGet("/tenants/{id:guid}/users", async (Guid id, MajoraDb db) => Results.Ok(await db.Users.Where(x => x.TenantId == id).Select(x => new { x.Id, x.Username, x.DisplayName, x.Role, x.Enabled }).ToListAsync()));
admin.MapGet("/users", async (MajoraDb db) => Results.Ok(await db.Users.AsNoTracking()
    .GroupJoin(db.Tenants.AsNoTracking(), u => u.TenantId, t => (Guid?)t.Id,
        (u, tenants) => new { u, tenants })
    .SelectMany(x => x.tenants.DefaultIfEmpty(), (x, tenant) => new {
        x.u.Id, x.u.Username, x.u.DisplayName, x.u.Role, x.u.Enabled,
        x.u.TenantId, TenantName = tenant == null ? "MAJORA" : tenant.Name
    }).OrderBy(x => x.TenantName).ThenBy(x => x.Username).ToListAsync()));
admin.MapPut("/users/{id:guid}/username", async (Guid id, UsernameUpdate body, MajoraDb db, HttpContext c) =>
{
    var newName = body.Username?.Trim();
    if (string.IsNullOrWhiteSpace(newName) || newName.Length > 100) return Fail("نام کاربری باید بین ۱ تا ۱۰۰ نویسه باشد.");
    var user = await db.Users.SingleOrDefaultAsync(x => x.Id == id && x.Role != "platform_admin");
    if (user is null) return Results.NotFound();
    if (user.Username == newName) return Results.Ok(new { user.Id, user.Username });
    if (await db.Users.AnyAsync(x => x.Username == newName)) return Fail("این نام کاربری قبلاً استفاده شده است.", 409);
    var oldName = user.Username; user.Username = newName; user.AuthVersion++;
    Audit(db, c.User, user.TenantId, "user.username.admin-update", "user", id, $"old={oldName};new={newName}");
    try { await db.SaveChangesAsync(); } catch (DbUpdateException) { return Fail("این نام کاربری هم‌زمان ثبت شده است.", 409); }
    return Results.Ok(new { user.Id, user.Username });
});
admin.MapGet("/activity", async (Guid? tenantId, int? page, string? q, MajoraDb db) =>
{
    var search = q?.Trim();
    if (search?.Length > 100) return Fail("عبارت جست‌وجو نباید بیش از ۱۰۰ نویسه باشد.");
    var events = db.Audit.AsNoTracking().Where(x => tenantId == null || x.TenantId == tenantId)
        .Join(db.Users.AsNoTracking(), a => a.ActorId, u => u.Id,
            (a, u) => new { a.Id, a.TenantId, a.At, a.Action, a.EntityType, a.EntityId, a.Detail, ActorName = u.Username });
    if (!string.IsNullOrEmpty(search)) events = events.Where(x => x.ActorName.Contains(search) || x.Action.Contains(search) || x.EntityType.Contains(search) || x.EntityId.Contains(search) || x.Detail.Contains(search));
    return Results.Ok(await events.OrderByDescending(x => x.At).Skip(Math.Max(0, (page ?? 1) - 1) * 100).Take(100).ToListAsync());
});
admin.MapPost("/users/{id:guid}/reset-password", async (Guid id, PasswordReset body, MajoraDb db, IPasswordHasher<AppUser> hasher, HttpContext c) =>
{
    if (body.NewPassword.Length < 12) return Fail("رمز جدید باید حداقل ۱۲ نویسه باشد.");
    var user = await db.Users.FindAsync(id); if (user is null || user.Role == "platform_admin") return Results.NotFound();
    user.PasswordHash = hasher.HashPassword(user, body.NewPassword); user.AuthVersion++;
    Audit(db, c.User, user.TenantId, "password.admin-reset", "user", id); await db.SaveChangesAsync(); return Results.NoContent();
});

var merchant = app.MapGroup("/api/merchant").RequireAuthorization();
merchant.AddEndpointFilter(async (invocation, next) =>
{
    var c = invocation.HttpContext;
    if (!c.User.HasClaim(x => x.Type == "tenant")) return Fail("این بخش برای حساب فروشگاه است.", 403);
    var db = c.RequestServices.GetRequiredService<MajoraDb>();
    var subscriptionSelfService = c.Request.Path.StartsWithSegments("/api/merchant/subscription") ||
        c.Request.Path.StartsWithSegments("/api/merchant/plans") ||
        c.Request.Path.StartsWithSegments("/api/merchant/billing");
    if (!await Active(db, TenantId(c.User)) && !subscriptionSelfService) return Fail("اشتراک فعال نیست.", 403);
    return await next(invocation);
});
merchant.MapGet("/subscription", async (MajoraDb db, HttpContext c) =>
{
    var tid = TenantId(c.User);
    return Results.Ok(await db.Subscriptions.Where(s => s.TenantId == tid).Join(db.Plans, s => s.PlanId, p => p.Id, (s,p) => new { s.Id, Plan = p.Name, s.StartsAt, s.EndsAt, s.PaymentStatus, s.PriceRialSnapshot, p.MaxUsers }).OrderByDescending(s => s.EndsAt).ToListAsync());
});
merchant.MapGet("/plans", async (MajoraDb db) => Results.Ok(await db.Plans.AsNoTracking()
    .Where(x => x.Enabled).OrderBy(x => x.MonthlyRial).ToListAsync()));
merchant.MapGet("/billing", async (MajoraDb db) => Results.Ok(await db.PlatformBilling.AsNoTracking().SingleOrDefaultAsync(x => x.Id == 1)
    ?? new PlatformBilling()));
merchant.MapGet("/subscription/quote", async (Guid planId, string? code, MajoraDb db) =>
{
    var plan = await db.Plans.AsNoTracking().SingleOrDefaultAsync(x => x.Id == planId && x.Enabled);
    if (plan is null) return Results.NotFound();
    var normalized = code?.Trim().ToUpperInvariant() ?? "";
    decimal discount = 0;
    if (normalized.Length > 0)
    {
        var now = DateTime.UtcNow;
        var promo = await db.PromoCodes.AsNoTracking().SingleOrDefaultAsync(x => x.Code == normalized && x.Enabled && x.StartsAt <= now && x.ExpiresAt > now);
        if (promo is null) return Fail("کد تخفیف معتبر نیست یا منقضی شده است.", 409);
        discount = promo.Percent;
    }
    return Results.Ok(new { plan.Id, plan.Name, basePriceRial = plan.MonthlyRial, discountPercent = discount,
        totalRial = DiscountedPrice(plan.MonthlyRial, discount), promoCode = normalized });
});
merchant.MapGet("/subscription/orders", async (MajoraDb db, HttpContext c) =>
{
    var tid = TenantId(c.User);
    return Results.Ok(await db.SubscriptionOrders.AsNoTracking().Where(x => x.TenantId == tid)
        .OrderByDescending(x => x.CreatedAt).Take(50)
        .Select(x => new { x.Id, x.PlanNameSnapshot, x.PromoCodeSnapshot, x.BasePriceRial, x.TotalRial,
            x.Status, x.PaymentMethod, x.CreatedAt, x.ReviewedAt }).ToListAsync());
});
merchant.MapPost("/subscription/orders", async (SubscriptionOrderRequest body, MajoraDb db, HttpContext c) =>
{
    if (Role(c.User) != "owner") return Results.Forbid();
    if (string.IsNullOrWhiteSpace(body.IdempotencyKey) || body.IdempotencyKey.Length > 100) return Fail("شناسهٔ درخواست نامعتبر است.");
    if (!ProductPhotos.TryDecode(body.ReceiptDataUrl ?? "", out var contentType, out var bytes))
        return Fail("تصویر رسید باید JPEG، PNG یا WebP معتبر و کمتر از یک مگابایت باشد.");
    var tid = TenantId(c.User);
    await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
    var existing = await db.SubscriptionOrders.SingleOrDefaultAsync(x => x.TenantId == tid && x.IdempotencyKey == body.IdempotencyKey);
    if (existing is not null) return existing.PlanId == body.PlanId && existing.PromoCodeSnapshot == (body.PromoCode?.Trim().ToUpperInvariant() ?? "")
        ? Results.Ok(new { existing.Id, existing.Status, existing.TotalRial }) : Fail("شناسهٔ درخواست برای سفارش دیگری استفاده شده است.", 409);
    if (await db.SubscriptionOrders.CountAsync(x => x.TenantId == tid && x.Status == "pending_approval") >= 5)
        return Fail("پنج درخواست در انتظار بررسی دارید؛ پس از تعیین وضعیت یکی از آن‌ها دوباره تلاش کنید.", 409);
    var billing = await db.PlatformBilling.AsNoTracking().SingleOrDefaultAsync(x => x.Id == 1);
    if (billing is null || billing.CardNumber.Length == 0) return Fail("اطلاعات واریز هنوز در پنل ماژورا تنظیم نشده است.", 409);
    var plan = await db.Plans.AsNoTracking().SingleOrDefaultAsync(x => x.Id == body.PlanId && x.Enabled);
    if (plan is null) return Results.NotFound();
    var normalized = body.PromoCode?.Trim().ToUpperInvariant() ?? "";
    decimal discount = 0;
    if (normalized.Length > 0)
    {
        var now = DateTime.UtcNow;
        var promo = await db.PromoCodes.AsNoTracking().SingleOrDefaultAsync(x => x.Code == normalized && x.Enabled && x.StartsAt <= now && x.ExpiresAt > now);
        if (promo is null) return Fail("کد تخفیف معتبر نیست یا منقضی شده است.", 409);
        discount = promo.Percent;
    }
    var total = DiscountedPrice(plan.MonthlyRial, discount);
    if (body.ExpectedTotalRial != total) return Fail("مبلغ طرح یا تخفیف تغییر کرده است؛ مبلغ را دوباره بررسی کنید.", 409);
    var order = new SubscriptionOrder { TenantId = tid, PlanId = plan.Id, PlanNameSnapshot = plan.Name,
        IdempotencyKey = body.IdempotencyKey, PromoCodeSnapshot = normalized, DiscountPercentSnapshot = discount,
        BasePriceRial = plan.MonthlyRial, TotalRial = total,
        ReceiptBytes = bytes, ReceiptContentType = contentType, Status = "pending_approval" };
    db.SubscriptionOrders.Add(order); Audit(db, c.User, tid, "subscription-order.submit", "subscription-order", order.Id);
    try { await db.SaveChangesAsync(); await tx.CommitAsync(); }
    catch (DbUpdateException) { return Fail("سفارش هم‌زمان ثبت شد؛ فهرست درخواست‌ها را تازه کنید.", 409); }
    return Results.Created($"/api/merchant/subscription/orders/{order.Id}", new { order.Id, order.Status, order.TotalRial });
});
merchant.MapGet("/workspace", async (MajoraDb db, HttpContext c) => { var tid = TenantId(c.User); var tenant = await db.Tenants.SingleAsync(t => t.Id == tid); var profile = await db.InvoiceBrands.AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tid); return Results.Ok(new { tenant.Name, tenant.Slug, LogoUrl = profile?.LogoDataUrl ?? tenant.LogoUrl, tenant.BrandColor }); });
merchant.MapGet("/search", async (string? q, MajoraDb db, HttpContext c) =>
{
    var term = q?.Trim();
    if (string.IsNullOrEmpty(term)) return Results.Ok(Array.Empty<GlobalSearchHit>());
    if (term.Length > 100) return Fail("عبارت جست‌وجو نباید بیش از ۱۰۰ نویسه باشد.");
    var tid = TenantId(c.User); var hits = new List<GlobalSearchHit>();
    hits.AddRange(await db.Products.AsNoTracking().Where(x => x.TenantId == tid && !x.Archived && (x.Name.Contains(term) || x.Sku.Contains(term) || x.Category.Contains(term)))
        .OrderBy(x => x.Name).Take(8).Select(x => new GlobalSearchHit("product", x.Id, x.Name, x.Sku + " · " + x.Category)).ToListAsync());
    hits.AddRange(await db.Customers.AsNoTracking().Where(x => x.TenantId == tid && !x.Archived && (x.Name.Contains(term) || x.Phone.Contains(term)))
        .OrderBy(x => x.Name).Take(8).Select(x => new GlobalSearchHit("customer", x.Id, x.Name, x.Phone)).ToListAsync());
    var isNumber = long.TryParse(term, out var invoiceNumber);
    hits.AddRange(await db.Invoices.AsNoTracking().Where(x => x.TenantId == tid && !x.Archived && (x.CustomerName.Contains(term) || x.CustomerPhone.Contains(term) || (isNumber && x.Number == invoiceNumber)))
        .OrderByDescending(x => x.IssuedAt).Take(8).Select(x => new GlobalSearchHit("invoice", x.Id, "فاکتور " + x.Number, x.CustomerName)).ToListAsync());
    hits.AddRange(await db.Cheques.AsNoTracking().Where(x => x.TenantId == tid && (x.Party.Contains(term) || x.Serial.Contains(term) || x.Bank.Contains(term) || x.SayadId.Contains(term)))
        .OrderByDescending(x => x.CreatedAt).Take(8).Select(x => new GlobalSearchHit("cheque", x.Id, x.Party + " · " + x.Serial, x.Bank)).ToListAsync());
    hits.AddRange(await db.Reminders.AsNoTracking().Where(x => x.TenantId == tid && !x.Done && x.Title.Contains(term))
        .OrderBy(x => x.DueAt).Take(8).Select(x => new GlobalSearchHit("reminder", x.Id, x.Title, "یادآور باز")).ToListAsync());
    hits.AddRange(await db.Purchases.AsNoTracking().Where(x => x.TenantId == tid && (x.SupplierName.Contains(term) || x.SupplierInvoiceNumber.Contains(term)))
        .OrderByDescending(x => x.PurchasedAt).Take(8).Select(x => new GlobalSearchHit("purchase", x.Id, x.SupplierName, x.SupplierInvoiceNumber)).ToListAsync());
    hits.AddRange(await db.Expenses.AsNoTracking().Where(x => x.TenantId == tid && !x.Voided && (x.Category.Contains(term) || x.Description.Contains(term)))
        .OrderByDescending(x => x.IncurredAt).Take(8).Select(x => new GlobalSearchHit("expense", x.Id, x.Category, x.Description)).ToListAsync());
    return Results.Ok(hits);
});
merchant.MapGet("/invoice-brand", async (MajoraDb db, HttpContext c) =>
{
    var tid = TenantId(c.User);
    var profile = await db.InvoiceBrands.AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tid);
    if (profile is null) profile = InvoiceBrand.Create(tid, (await db.Tenants.SingleAsync(x => x.Id == tid)).Name, false, null);
    return Results.Ok(InvoiceBrand.View(profile));
});
merchant.MapPut("/invoice-brand", async (InvoiceBrandUpdate body, MajoraDb db, HttpContext c) =>
{
    var tid = TenantId(c.User);
    var tenant = await db.Tenants.SingleAsync(x => x.Id == tid);
    var profile = await db.InvoiceBrands.SingleOrDefaultAsync(x => x.TenantId == tid);
    if (profile is null) { profile = InvoiceBrand.Create(tid, tenant.Name, false, null); db.InvoiceBrands.Add(profile); }
    if (body.Revision != profile.Revision) return Fail("مشخصات فاکتور در جای دیگری تغییر کرده است؛ صفحه را تازه کنید.", 409);
    if (body.StoreName != profile.StoreName || body.Slogan != profile.Slogan || body.LogoDataUrl != profile.LogoDataUrl)
        return Results.Forbid();
    var invalid = InvoiceBrand.Validate(body); if (invalid is not null) return Fail(invalid);
    InvoiceBrand.Apply(profile, body);
    Audit(db, c.User, tid, "invoice-brand.merchant-update", "invoice-brand", tid,
        JsonSerializer.Serialize(new { profile.Revision, fields = "phone,address,card,cardHolder,note,conditions,social" }));
    try { await db.SaveChangesAsync(); }
    catch (DbUpdateConcurrencyException) { return Fail("مشخصات فاکتور هم‌زمان تغییر کرده است؛ صفحه را تازه کنید.", 409); }
    catch (DbUpdateException) { return Fail("مشخصات فاکتور هم‌زمان ثبت شد؛ صفحه را تازه کنید.", 409); }
    return Results.Ok(InvoiceBrand.View(profile));
});
merchant.MapGet("/dashboard", async (MajoraDb db, HttpContext c) =>
{
    var tid = TenantId(c.User); var since = DateTime.UtcNow.AddDays(-30);
    var sales = await FinanceMath.LoadSalesMetricsAsync(db, tid, since);
    var receipts30 = await db.Payments.Where(x => x.TenantId == tid && x.ReceivedAt >= since).SumAsync(x => x.AmountRial);
    var refunds30 = await db.Refunds.Where(x => x.TenantId == tid && x.RefundedAt >= since).SumAsync(x => x.AmountRial);
    return Results.Ok(new { sales30Rial = sales.NetSalesRial, received30Rial = receipts30 - refunds30, receivable30Rial = sales.ReceivableRial, refundDueRial = sales.RefundDueRial, invoiceCount30 = sales.InvoiceCount, customers = await db.Customers.CountAsync(x => x.TenantId == tid && !x.Archived), products = await db.Products.CountAsync(x => x.TenantId == tid && !x.Archived), lowStock = await db.Products.CountAsync(x => x.TenantId == tid && !x.Archived && x.Stock <= 3), overdue = await db.Reminders.CountAsync(x => x.TenantId == tid && !x.Done && x.DueAt <= DateTime.UtcNow), openCheques = await db.Cheques.CountAsync(x => x.TenantId == tid && x.Status == "open"), dueCheques = await db.Cheques.CountAsync(x => x.TenantId == tid && x.Status == "open" && x.DueAt <= DateTime.UtcNow) });
});
merchant.MapGet("/products/meta", async (MajoraDb db, HttpContext c) => { var tid = TenantId(c.User); var products = db.Products.Where(x => x.TenantId == tid && !x.Archived); return Results.Ok(new { count = await products.CountAsync(), categories = await products.Select(x => x.Category).Distinct().OrderBy(x => x).ToListAsync() }); });
merchant.MapGet("/products", async (string? q, string? category, int? page, MajoraDb db, HttpContext c) => { var tid = TenantId(c.User); return Results.Ok(await db.Products.Where(x => x.TenantId == tid && !x.Archived && (q == null || x.Name.Contains(q) || x.Sku.Contains(q)) && (string.IsNullOrEmpty(category) || x.Category == category || x.Category.StartsWith(category + " / ") || x.Category.StartsWith(category + "/"))).OrderBy(x => x.Name).Skip(Math.Max(0, (page ?? 1) - 1) * 50).Take(50).ToListAsync()); });
merchant.MapPost("/products", async (ProductRequest body, MajoraDb db, HttpContext c) =>
{
    if (!CanWrite(c.User)) return Results.Forbid();
    if (string.IsNullOrWhiteSpace(body.Name) || string.IsNullOrWhiteSpace(body.Sku) || body.PriceRial < 0 || body.Stock < 0 || body.AverageCostRial < 0) return Fail("مشخصات کالا نامعتبر است.");
    if (body.PhotoDataUrl is { Length: > 0 } && !ProductPhotos.TryDecode(body.PhotoDataUrl, out _, out _)) return Fail("تصویر کالا معتبر نیست.");
    var product = new Product { TenantId = TenantId(c.User), Name = body.Name.Trim(), Sku = body.Sku.Trim(), Category = body.Category.Trim(), PriceRial = body.PriceRial, Stock = body.Stock, AverageCostRial = body.AverageCostRial ?? 0, CostKnown = body.AverageCostRial is not null };
    if (body.PhotoDataUrl is { Length: > 0 } && ProductPhotos.TryDecode(body.PhotoDataUrl, out var contentType, out var bytes))
    {
        product.HasPhoto = true;
        db.ProductPhotos.Add(new ProductPhoto { ProductId = product.Id, TenantId = product.TenantId, ContentType = contentType, Bytes = bytes });
    }
    db.Products.Add(product); Audit(db, c.User, product.TenantId, "product.create", "product", product.Id); await db.SaveChangesAsync(); return Results.Created($"/api/merchant/products/{product.Id}", product);
});
merchant.MapPut("/products/{id:guid}", async (Guid id, ProductRequest body, MajoraDb db, HttpContext c) =>
{
    if (!CanWrite(c.User)) return Results.Forbid();
    var tid = TenantId(c.User); var p = await db.Products.SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tid && !x.Archived); if (p is null) return Results.NotFound();
    if (string.IsNullOrWhiteSpace(body.Name) || body.PriceRial < 0 || body.Stock < 0 || body.AverageCostRial < 0) return Fail("مشخصات کالا نامعتبر است.");
    if (body.PhotoDataUrl is { Length: > 0 } && !ProductPhotos.TryDecode(body.PhotoDataUrl, out _, out _)) return Fail("تصویر کالا معتبر نیست.");
    var delta = body.Stock - p.Stock; p.Name = body.Name.Trim(); p.Category = body.Category.Trim(); p.Sku = body.Sku.Trim(); p.PriceRial = body.PriceRial; p.Stock = body.Stock; p.UpdatedAt = DateTime.UtcNow;
    if (body.AverageCostRial is long cost) { p.AverageCostRial = cost; p.CostKnown = true; }
    if (body.PhotoDataUrl is not null)
    {
        var existingPhoto = await db.ProductPhotos.SingleOrDefaultAsync(x => x.ProductId == id && x.TenantId == tid);
        if (body.PhotoDataUrl.Length == 0) { if (existingPhoto is not null) db.ProductPhotos.Remove(existingPhoto); p.HasPhoto = false; }
        else if (ProductPhotos.TryDecode(body.PhotoDataUrl, out var contentType, out var bytes))
        {
            if (existingPhoto is null) db.ProductPhotos.Add(new ProductPhoto { ProductId = id, TenantId = tid, ContentType = contentType, Bytes = bytes });
            else { existingPhoto.ContentType = contentType; existingPhoto.Bytes = bytes; }
            p.HasPhoto = true;
        }
    }
    if (delta != 0) db.StockMovements.Add(new StockMovement { TenantId = p.TenantId, ProductId = p.Id, Delta = delta, Reason = "manual-adjustment" });
    Audit(db, c.User, p.TenantId, "product.update", "product", p.Id); await db.SaveChangesAsync(); return Results.Ok(p);
});
merchant.MapPut("/products/{id:guid}/price", async (Guid id, ProductPriceUpdate body, MajoraDb db, HttpContext c) =>
{
    if (!CanWrite(c.User)) return Results.Forbid();
    if (body.NewPriceRial < 0 || body.NewPriceRial == body.ExpectedPriceRial) return Fail("قیمت جدید باید معتبر و متفاوت از قیمت فعلی باشد.");
    var tid = TenantId(c.User);
    var product = await db.Products.SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tid && !x.Archived);
    if (product is null) return Results.NotFound();
    if (product.PriceRial != body.ExpectedPriceRial) return Fail("قیمت کالا در جای دیگری تغییر کرده است؛ فهرست را تازه کنید.", 409);
    product.PriceRial = body.NewPriceRial; product.UpdatedAt = DateTime.UtcNow;
    Audit(db, c.User, tid, "product.price-update", "product", id,
        JsonSerializer.Serialize(new { oldPriceRial = body.ExpectedPriceRial, newPriceRial = body.NewPriceRial }));
    await db.SaveChangesAsync(); return Results.Ok(product);
});
merchant.MapGet("/products/{id:guid}/photo", async (Guid id, MajoraDb db, HttpContext c) =>
{
    var tid = TenantId(c.User);
    var photo = await db.ProductPhotos.AsNoTracking().SingleOrDefaultAsync(x => x.ProductId == id && x.TenantId == tid);
    if (photo is null) return Results.NotFound();
    c.Response.Headers.CacheControl = "private, max-age=60";
    c.Response.Headers.XContentTypeOptions = "nosniff";
    return Results.File(photo.Bytes, photo.ContentType);
});
merchant.MapPut("/products/{id:guid}/photo", async (Guid id, ProductPhotoRequest body, MajoraDb db, HttpContext c) =>
{
    if (!CanWrite(c.User)) return Results.Forbid();
    var tid = TenantId(c.User);
    var product = await db.Products.SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tid && !x.Archived);
    if (product is null) return Results.NotFound();
    if (!ProductPhotos.TryDecode(body.DataUrl, out var contentType, out var bytes)) return Fail("تصویر باید JPEG، PNG یا WebP معتبر و کمتر از یک مگابایت باشد.");
    var photo = await db.ProductPhotos.SingleOrDefaultAsync(x => x.ProductId == id && x.TenantId == tid);
    if (photo is null) db.ProductPhotos.Add(new ProductPhoto { ProductId = id, TenantId = tid, ContentType = contentType, Bytes = bytes });
    else { photo.ContentType = contentType; photo.Bytes = bytes; }
    product.HasPhoto = true; product.UpdatedAt = DateTime.UtcNow;
    Audit(db, c.User, tid, "product.photo.update", "product", id);
    await db.SaveChangesAsync();
    return Results.Ok(new { product.Id, product.HasPhoto });
});
merchant.MapDelete("/products/{id:guid}/photo", async (Guid id, MajoraDb db, HttpContext c) =>
{
    if (!CanWrite(c.User)) return Results.Forbid();
    var tid = TenantId(c.User);
    var product = await db.Products.SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tid && !x.Archived);
    if (product is null) return Results.NotFound();
    var photo = await db.ProductPhotos.SingleOrDefaultAsync(x => x.ProductId == id && x.TenantId == tid);
    if (photo is not null) db.ProductPhotos.Remove(photo);
    product.HasPhoto = false; product.UpdatedAt = DateTime.UtcNow;
    Audit(db, c.User, tid, "product.photo.remove", "product", id);
    await db.SaveChangesAsync();
    return Results.NoContent();
});
merchant.MapGet("/price-batches", async (MajoraDb db, HttpContext c) =>
{
    var tid = TenantId(c.User);
    return Results.Ok(await db.PriceBatches.AsNoTracking().Where(x => x.TenantId == tid)
        .OrderByDescending(x => x.CreatedAt).Take(50)
        .Select(x => new { x.Id, x.Percent, x.CreatedAt, x.RevertedAt, Count = x.Lines.Count }).ToListAsync());
});
merchant.MapGet("/price-batches/{id:guid}/lines", async (Guid id, string? q, int? page, MajoraDb db, HttpContext c) =>
{
    var tid = TenantId(c.User);
    if (!await db.PriceBatches.AnyAsync(x => x.Id == id && x.TenantId == tid)) return Results.NotFound();
    return Results.Ok(await db.PriceBatchLines.AsNoTracking().Where(x => x.PriceBatchId == id && (q == null || x.NameSnapshot.Contains(q)))
        .OrderBy(x => x.NameSnapshot).Skip(Math.Max(0, (page ?? 1) - 1) * 50).Take(50)
        .Select(x => new { x.Id, x.ProductId, x.NameSnapshot, x.OldPriceRial, x.NewPriceRial }).ToListAsync());
});
merchant.MapPost("/price-batches", async (PriceBatchRequest body, MajoraDb db, HttpContext c) =>
{
    if (!CanWrite(c.User)) return Results.Forbid();
    if (string.IsNullOrWhiteSpace(body.IdempotencyKey) || body.IdempotencyKey.Length > 100 || body.Percent <= 0 || body.Percent > 1000 ||
        (!body.AllProducts && (body.ProductIds is null || body.ProductIds.Count == 0)) || (body.AllProducts && body.ProductIds is { Count: > 0 }))
        return Fail("درصد یا انتخاب کالاها معتبر نیست.");
    var tid = TenantId(c.User);
    await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
    var previous = await db.PriceBatches.AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tid && x.IdempotencyKey == body.IdempotencyKey);
    if (previous is not null) return Results.Ok(new { previous.Id, previous.Percent, previous.CreatedAt, previous.RevertedAt });
    var ids = body.ProductIds?.Distinct().ToList() ?? [];
    if (!body.AllProducts && ids.Count != body.ProductIds!.Count) return Fail("کالا تکراری انتخاب شده است.");
    var products = body.AllProducts
        ? await db.Products.Where(x => x.TenantId == tid && !x.Archived).ToListAsync()
        : await db.Products.Where(x => x.TenantId == tid && !x.Archived && ids.Contains(x.Id)).ToListAsync();
    if (products.Count == 0 || (!body.AllProducts && products.Count != ids.Count)) return Fail("یک یا چند کالا پیدا نشد.", 409);
    var changes = new List<(Product Product, long NewPrice)>();
    try
    {
        foreach (var product in products)
            changes.Add((product, checked((long)Math.Round(product.PriceRial * (100m + body.Percent) / 100m, 0, MidpointRounding.AwayFromZero))));
    }
    catch (OverflowException) { return Fail("مبلغ جدید از محدودهٔ ریال پشتیبانی‌شده بیشتر است."); }
    var batch = new PriceBatch { TenantId = tid, IdempotencyKey = body.IdempotencyKey.Trim(), Percent = body.Percent };
    foreach (var (product, newPrice) in changes)
    {
        batch.Lines.Add(new PriceBatchLine { ProductId = product.Id, NameSnapshot = product.Name, OldPriceRial = product.PriceRial, NewPriceRial = newPrice });
        product.PriceRial = newPrice;
        product.UpdatedAt = DateTime.UtcNow;
    }
    db.PriceBatches.Add(batch);
    Audit(db, c.User, tid, "price.batch.apply", "price-batch", batch.Id, $"percent={body.Percent}; count={products.Count}");
    try { await db.SaveChangesAsync(); await tx.CommitAsync(); }
    catch (DbUpdateException) { return Fail("تغییر هم‌زمان قیمت رخ داد؛ فهرست را تازه کنید.", 409); }
    return Results.Created($"/api/merchant/price-batches/{batch.Id}", new { batch.Id, batch.Percent, batch.CreatedAt, Count = products.Count });
});
merchant.MapPost("/price-batches/{id:guid}/revert", async (Guid id, MajoraDb db, HttpContext c) =>
{
    if (!CanWrite(c.User)) return Results.Forbid();
    var tid = TenantId(c.User);
    await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
    var batch = await db.PriceBatches.Include(x => x.Lines).SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tid);
    if (batch is null) return Results.NotFound();
    if (batch.RevertedAt is not null) return Fail("این تغییر قیمت قبلاً بازگردانده شده است.", 409);
    var ids = batch.Lines.Select(x => x.ProductId).ToList();
    var products = await db.Products.Where(x => x.TenantId == tid && ids.Contains(x.Id)).ToDictionaryAsync(x => x.Id);
    if (batch.Lines.Any(x => !products.TryGetValue(x.ProductId, out var p) || p.PriceRial != x.NewPriceRial))
        return Fail("قیمت بعضی کالاها پس از این نوبت تغییر کرده است؛ بازگردانی یکجا ممکن نیست.", 409);
    foreach (var line in batch.Lines)
    {
        var product = products[line.ProductId];
        product.PriceRial = line.OldPriceRial;
        product.UpdatedAt = DateTime.UtcNow;
    }
    batch.RevertedAt = DateTime.UtcNow;
    Audit(db, c.User, tid, "price.batch.revert", "price-batch", batch.Id, $"count={batch.Lines.Count}");
    await db.SaveChangesAsync(); await tx.CommitAsync();
    return Results.Ok(new { batch.Id, batch.RevertedAt });
});
merchant.MapGet("/customers", async (string? q, MajoraDb db, HttpContext c) => { var tid = TenantId(c.User); return Results.Ok(await db.Customers.Where(x => x.TenantId == tid && !x.Archived && (q == null || x.Name.Contains(q) || x.Phone.Contains(q))).OrderByDescending(x => x.CreatedAt).Take(100).ToListAsync()); });
merchant.MapGet("/customers/with-status", async (string? q, MajoraDb db, HttpContext c) =>
{
    var tid = TenantId(c.User);
    var customers = await db.Customers.AsNoTracking().Where(x => x.TenantId == tid && !x.Archived &&
        (q == null || x.Name.Contains(q) || x.Phone.Contains(q))).OrderByDescending(x => x.CreatedAt).Take(100).ToListAsync();
    var ids = customers.Select(x => x.Id).ToArray();
    var invoices = await db.Invoices.AsNoTracking().Where(x => x.TenantId == tid && x.CustomerId != null && ids.Contains(x.CustomerId.Value))
        .Select(x => new { x.Id, x.CustomerId, x.Status, x.PaymentStatus, x.TotalRial, x.ReturnedRial, x.PaidRial, x.RefundedRial }).ToListAsync();
    var invoiceIds = invoices.Select(x => x.Id).ToArray();
    var returnedCheques = await db.Cheques.AsNoTracking().Where(x => x.TenantId == tid && x.InvoiceId != null &&
        invoiceIds.Contains(x.InvoiceId.Value) && x.Status == "returned").Select(x => x.InvoiceId!.Value).ToListAsync();
    return Results.Ok(customers.Select(customer =>
    {
        var related = invoices.Where(x => x.CustomerId == customer.Id).ToList();
        var receivable = related.Where(x => x.Status == "issued" && x.PaymentStatus != "proforma")
            .Sum(x => Math.Max(0, x.TotalRial - x.ReturnedRial - x.PaidRial + x.RefundedRial));
        var status = related.Any(x => returnedCheques.Contains(x.Id)) ? "returned_cheque" : receivable > 0 ? "receivable" :
            related.Any(x => x.Status == "issued" && x.PaymentStatus != "proforma") ? "settled" :
            related.Any() ? "proforma" : "no_sales";
        return new { customer.Id, customer.Name, customer.Phone, customer.Address, customer.Occupation,
            customer.AcquisitionSource, customer.ReferrerPhone, customer.Notes, status, receivableRial = receivable };
    }).ToList());
});
merchant.MapGet("/customers/export.csv", async (MajoraDb db, HttpContext c) =>
{
    if (!CanWrite(c.User)) return Results.Forbid();
    var tid = TenantId(c.User);
    var customers = await db.Customers.AsNoTracking().Where(x => x.TenantId == tid && !x.Archived).OrderBy(x => x.Name).ToListAsync();
    static string Cell(string value)
    {
        var safe = value.Replace('\r', ' ').Replace('\n', ' ').Trim();
        if (safe.Length > 0 && "=+-@\t".Contains(safe[0])) safe = "'" + safe;
        return "\"" + safe.Replace("\"", "\"\"") + "\"";
    }
    var csv = new StringBuilder("ردیف,نام و نام خانوادگی,شماره تماس\r\n");
    for (var index = 0; index < customers.Count; index++)
        csv.Append(index + 1).Append(',').Append(Cell(customers[index].Name)).Append(',').Append(Cell(customers[index].Phone)).Append("\r\n");
    var bytes = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(csv.ToString())).ToArray();
    return Results.File(bytes, "text/csv; charset=utf-8", $"majora-customers-{DateTime.UtcNow:yyyyMMdd}.csv");
});
merchant.MapGet("/customers/export.xlsx", async (MajoraDb db, HttpContext c) =>
{
    if (!CanWrite(c.User)) return Results.Forbid();
    var tid = TenantId(c.User);
    var customers = await db.Customers.AsNoTracking().Where(x => x.TenantId == tid && !x.Archived)
        .OrderBy(x => x.Name).ThenBy(x => x.Id).ToListAsync();
    if (customers.Count > 1_048_575) return Fail("تعداد مشتریان از ظرفیت یک برگهٔ Excel بیشتر است؛ از خروجی CSV استفاده کنید.", 409);
    var bytes = CustomerWorkbook.Create(customers);
    c.Response.Headers.CacheControl = "no-store";
    return Results.File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        $"majora-customers-{DateTime.UtcNow:yyyyMMdd}.xlsx");
});
merchant.MapGet("/archive/products", async (string? q, int? page, MajoraDb db, HttpContext c) => { var tid = TenantId(c.User); return Results.Ok(await db.Products.AsNoTracking().Where(x => x.TenantId == tid && x.Archived && (q == null || x.Name.Contains(q) || x.Sku.Contains(q))).OrderBy(x => x.Name).Skip(Math.Max(0, (page ?? 1) - 1) * 50).Take(50).ToListAsync()); });
merchant.MapGet("/archive/customers", async (string? q, int? page, MajoraDb db, HttpContext c) => { var tid = TenantId(c.User); return Results.Ok(await db.Customers.AsNoTracking().Where(x => x.TenantId == tid && x.Archived && (q == null || x.Name.Contains(q) || x.Phone.Contains(q))).OrderByDescending(x => x.CreatedAt).Skip(Math.Max(0, (page ?? 1) - 1) * 50).Take(50).ToListAsync()); });
merchant.MapGet("/archive/invoices", async (string? q, int? page, MajoraDb db, HttpContext c) => { var tid = TenantId(c.User); return Results.Ok(await db.Invoices.AsNoTracking().Where(x => x.TenantId == tid && x.Archived && (q == null || x.CustomerName.Contains(q) || x.Number.ToString() == q)).OrderByDescending(x => x.IssuedAt).Skip(Math.Max(0, (page ?? 1) - 1) * 50).Take(50).Select(x => new { x.Id, x.Number, x.CustomerName, x.CustomerPhone, x.IssuedAt, x.TotalRial, x.PaidRial, x.ReturnedRial, x.RefundedRial, x.PaymentStatus, x.Status }).ToListAsync()); });
merchant.MapPost("/archive/{kind}/{id:guid}", async (string kind, Guid id, MajoraDb db, HttpContext c) =>
{
    if (!CanWrite(c.User)) return Results.Forbid();
    var tid = TenantId(c.User);
    switch (kind)
    {
        case "products":
            var product = await db.Products.SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tid);
            if (product is null) return Results.NotFound();
            product.Archived = true; break;
        case "customers":
            var customer = await db.Customers.SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tid);
            if (customer is null) return Results.NotFound();
            customer.Archived = true; break;
        case "invoices":
            var invoice = await db.Invoices.SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tid);
            if (invoice is null) return Results.NotFound();
            if (await db.Cheques.AnyAsync(x => x.TenantId == tid && x.InvoiceId == id && x.Status == "open")) return Fail("چک این فاکتور هنوز باز است و فاکتور باید در پیگیری‌ها بماند.", 409);
            if (invoice.PaymentStatus != "proforma" && (FinanceMath.Receivable(invoice) > 0 || FinanceMath.RefundDue(invoice) > 0)) return Fail("فاکتور دارای مانده یا بازپرداخت باز است و باید در پیگیری‌ها بماند.", 409);
            invoice.Archived = true; break;
        default: return Results.NotFound();
    }
    Audit(db, c.User, tid, "archive.add", kind, id);
    await db.SaveChangesAsync();
    return Results.NoContent();
});
merchant.MapPost("/archive/{kind}/{id:guid}/restore", async (string kind, Guid id, MajoraDb db, HttpContext c) =>
{
    if (!CanWrite(c.User)) return Results.Forbid();
    var tid = TenantId(c.User);
    switch (kind)
    {
        case "products":
            var product = await db.Products.SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tid && x.Archived);
            if (product is null) return Results.NotFound();
            product.Archived = false; break;
        case "customers":
            var customer = await db.Customers.SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tid && x.Archived);
            if (customer is null) return Results.NotFound();
            customer.Archived = false; break;
        case "invoices":
            var invoice = await db.Invoices.SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tid && x.Archived);
            if (invoice is null) return Results.NotFound();
            invoice.Archived = false; break;
        default: return Results.NotFound();
    }
    Audit(db, c.User, tid, "archive.restore", kind, id);
    await db.SaveChangesAsync();
    return Results.NoContent();
});
merchant.MapPost("/customers", async (CustomerRequest body, MajoraDb db, HttpContext c) =>
{
    var phone = IranPhone.NormalizeOptional(body.Phone);
    var referrerPhone = IranPhone.NormalizeOptional(body.ReferrerPhone);
    if (phone is null || referrerPhone is null) return Fail("شماره تماس و شماره معرف، در صورت ورود، باید ۱۱ رقم معتبر باشند.");
    if (string.IsNullOrWhiteSpace(body.Name) || body.Name.Length > 200 || (body.Phone?.Length ?? 0) > 30 ||
        (body.Address?.Length ?? 0) > 500 || (body.Occupation?.Length ?? 0) > 120 ||
        (body.AcquisitionSource?.Length ?? 0) > 120 || (body.ReferrerPhone?.Length ?? 0) > 30 ||
        (body.Notes?.Length ?? 0) > 1000) return Fail("اطلاعات مشتری نامعتبر یا بیش از حد طولانی است.");
    var customer = new Customer { TenantId = TenantId(c.User), Name = body.Name.Trim(), Phone = phone,
        Address = body.Address?.Trim() ?? "", Occupation = body.Occupation?.Trim() ?? "",
        AcquisitionSource = body.AcquisitionSource?.Trim() ?? "", ReferrerPhone = referrerPhone,
        Notes = body.Notes?.Trim() ?? "" };
    db.Customers.Add(customer); Audit(db, c.User, customer.TenantId, "customer.create", "customer", customer.Id);
    await db.SaveChangesAsync(); return Results.Created($"/api/merchant/customers/{customer.Id}", customer);
});
merchant.MapPut("/customers/{id:guid}", async (Guid id, CustomerRequest body, MajoraDb db, HttpContext c) =>
{
    if (!CanWrite(c.User)) return Results.Forbid();
    var phone = IranPhone.NormalizeOptional(body.Phone);
    var referrerPhone = IranPhone.NormalizeOptional(body.ReferrerPhone);
    if (phone is null || referrerPhone is null) return Fail("شماره تماس و شماره معرف، در صورت ورود، باید ۱۱ رقم معتبر باشند.");
    if (string.IsNullOrWhiteSpace(body.Name) || body.Name.Length > 200 || (body.Phone?.Length ?? 0) > 30 ||
        (body.Address?.Length ?? 0) > 500 || (body.Occupation?.Length ?? 0) > 120 ||
        (body.AcquisitionSource?.Length ?? 0) > 120 || (body.ReferrerPhone?.Length ?? 0) > 30 ||
        (body.Notes?.Length ?? 0) > 1000) return Fail("اطلاعات مشتری نامعتبر یا بیش از حد طولانی است.");
    var tid = TenantId(c.User); var customer = await db.Customers.SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tid && !x.Archived);
    if (customer is null) return Results.NotFound();
    customer.Name = body.Name.Trim(); customer.Phone = phone;
    customer.Address = body.Address?.Trim() ?? ""; customer.Occupation = body.Occupation?.Trim() ?? "";
    customer.AcquisitionSource = body.AcquisitionSource?.Trim() ?? ""; customer.ReferrerPhone = referrerPhone;
    customer.Notes = body.Notes?.Trim() ?? "";
    Audit(db, c.User, tid, "customer.update", "customer", id); await db.SaveChangesAsync(); return Results.Ok(customer);
});
merchant.MapGet("/invoices", async (string? q, MajoraDb db, HttpContext c) => { var tid = TenantId(c.User); return Results.Ok(await db.Invoices.Where(x => x.TenantId == tid && !x.Archived && (q == null || x.CustomerName.Contains(q) || x.CustomerPhone.Contains(q) || x.Number.ToString() == q)).OrderByDescending(x => x.IssuedAt).Take(100).Select(x => new { x.Id, x.Number, x.Revision, x.CustomerName, x.CustomerPhone, x.IssuedAt, x.TotalRial, x.PaidRial, x.ReturnedRial, x.RefundedRial, x.PaymentStatus, x.Status }).ToListAsync()); });
merchant.MapGet("/invoices/{id:guid}", async (Guid id, MajoraDb db, HttpContext c) => { var tid = TenantId(c.User); var invoice = await db.Invoices.Include(x => x.Lines).SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tid); return invoice is null ? Results.NotFound() : Results.Ok(invoice); });
merchant.MapGet("/invoices/{id:guid}/cheque", async (Guid id, MajoraDb db, HttpContext c) =>
{
    var tid = TenantId(c.User);
    if (!await db.Invoices.AnyAsync(x => x.Id == id && x.TenantId == tid)) return Results.NotFound();
    var cheque = await db.Cheques.AsNoTracking().Where(x => x.InvoiceId == id && x.TenantId == tid)
        .Select(x => new { x.Id, x.Serial, x.Bank, x.AmountRial, x.DueAt, x.SayadId, x.IssuerNationalId,
            x.BeneficiaryNationalId, x.RegistrationStatus, x.Status, x.ShowDetails, x.ShowImage, HasPhoto = x.PhotoBytes != null }).SingleOrDefaultAsync();
    return Results.Ok(cheque);
});
merchant.MapGet("/invoices/{id:guid}/revisions", async (Guid id, MajoraDb db, HttpContext c) =>
{
    var tid = TenantId(c.User);
    if (!await db.Invoices.AnyAsync(x => x.Id == id && x.TenantId == tid)) return Results.NotFound();
    return Results.Ok(await db.InvoiceRevisions.AsNoTracking().Where(x => x.InvoiceId == id && x.TenantId == tid)
        .OrderByDescending(x => x.RevisionNo).Select(x => new { x.RevisionNo, x.Reason, x.RecordedAt, x.SnapshotJson }).ToListAsync());
});
merchant.MapPost("/invoices/{id:guid}/revisions", async (Guid id, InvoiceRevisionRequest body, MajoraDb db, HttpContext c) =>
{
    if (!CanSell(c.User)) return Results.Forbid();
    var revisedPhone = IranPhone.NormalizeOptional(body.CustomerPhone);
    if (revisedPhone is null) return Fail("شماره تماس مشتری، در صورت ورود، باید ۱۱ رقم معتبر باشد.");
    if (body.ExpectedRevision < 1 || string.IsNullOrWhiteSpace(body.Reason) || body.Reason.Length > 500 ||
        string.IsNullOrWhiteSpace(body.CustomerName) || body.CustomerName.Length > 200 || body.CustomerPhone is null || body.CustomerPhone.Length > 30 ||
        body.Lines is null || body.Lines.Count is < 1 or > 200 ||
        body.Lines.Where(x => x.LineId is not null).Select(x => x.LineId).Distinct().Count() != body.Lines.Count(x => x.LineId is not null))
        return Fail("دلیل ویرایش، مشتری و ردیف‌های فاکتور را بررسی کنید.");
    if (body.IssuedAt is DateTime changedDate && (changedDate.Kind != DateTimeKind.Utc || changedDate.Year < 2000 || changedDate.Year > 2100))
        return Fail("تاریخ فاکتور باید معتبر و همراه با منطقهٔ زمانی UTC باشد.");
    var tid = TenantId(c.User);
    await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
    var invoice = await db.Invoices.Include(x => x.Lines).SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tid && x.Status == "issued" && !x.Archived);
    if (invoice is null) return Results.NotFound();
    if (invoice.Revision != body.ExpectedRevision) return Fail("فاکتور در دستگاه دیگری تغییر کرده است؛ دوباره بازش کنید.", 409);
    if (await db.Cheques.AnyAsync(x => x.TenantId == tid && x.InvoiceId == id && x.Status == "open")) return Fail("چک این فاکتور هنوز باز است؛ پیش از ویرایش، وضعیت آن را تعیین کنید.", 409);
    if (invoice.ReturnedRial > 0 || invoice.RefundedRial > 0 || await db.SalesReturns.AnyAsync(x => x.InvoiceId == id && x.TenantId == tid))
        return Fail("فاکتور دارای مرجوعی یا بازپرداخت از مسیر اصلاح سند قابل تغییر نیست؛ برای اصلاح بعدی سند جداگانه ثبت کنید.", 409);
    var oldLines = invoice.Lines.ToDictionary(x => x.Id);
    var oldSnapshot = JsonSerializer.Serialize(invoice, JsonSerializerOptions.Web);
    var newLines = new List<InvoiceLine>();
    long newTotal = 0;
    try
    {
        foreach (var item in body.Lines)
        {
            if (string.IsNullOrWhiteSpace(item.Name) || item.Name.Length > 300 || item.UnitPriceRial < 0 || item.Quantity < 1 || item.Quantity > 1_000_000)
                return Fail("نام، قیمت یا تعداد یکی از ردیف‌ها معتبر نیست.");
            InvoiceLine? old = null;
            if (item.LineId is Guid lineId && (!oldLines.TryGetValue(lineId, out old) || old.ProductId != item.ProductId))
                return Fail("شناسه یا کالای ردیف تغییر کرده است؛ فاکتور را تازه کنید.", 409);
            Product? product = null;
            if (item.ProductId is Guid productId)
            {
                product = await db.Products.SingleOrDefaultAsync(x => x.Id == productId && x.TenantId == tid);
                if (product is null || (product.Archived && old is null)) return Fail("کالای جدید در فهرست فعال پیدا نشد.", 409);
            }
            var gross = checked(item.UnitPriceRial * item.Quantity);
            if (item.DiscountRial < 0 || item.DiscountRial > gross) return Fail("تخفیف ردیف از مبلغ آن بیشتر است.");
            var net = checked(gross - item.DiscountRial);
            newTotal = checked(newTotal + net);
            newLines.Add(new InvoiceLine { InvoiceId = id, ProductId = item.ProductId, NameSnapshot = item.Name.Trim(),
                UnitPriceRial = item.UnitPriceRial, Quantity = item.Quantity, TotalRial = net,
                UnitCostRialSnapshot = old?.UnitCostRialSnapshot ?? product?.AverageCostRial ?? 0,
                CostKnown = old?.CostKnown ?? product?.CostKnown ?? false });
        }
        if (invoice.PaymentStatus != "proforma")
        {
            if (invoice.PaidRial - invoice.RefundedRial > newTotal) return Fail("جمع اصلاح‌شده از وجه دریافت‌شده کمتر است؛ ابتدا وضعیت مالی را تعیین کنید.", 409);
            var deltas = new Dictionary<Guid, long>();
            foreach (var line in oldLines.Values.Where(x => x.ProductId is not null)) deltas[line.ProductId!.Value] = checked(deltas.GetValueOrDefault(line.ProductId.Value) + line.Quantity);
            foreach (var line in newLines.Where(x => x.ProductId is not null)) deltas[line.ProductId!.Value] = checked(deltas.GetValueOrDefault(line.ProductId.Value) - line.Quantity);
            foreach (var (productId, delta) in deltas.Where(x => x.Value != 0))
            {
                var product = await db.Products.SingleAsync(x => x.Id == productId && x.TenantId == tid);
                if (delta < 0 && product.Stock < -delta) return Fail($"موجودی «{product.Name}» برای اصلاح فاکتور کافی نیست.", 409);
                product.Stock = checked(product.Stock + delta); product.UpdatedAt = DateTime.UtcNow;
                db.StockMovements.Add(new StockMovement { TenantId = tid, ProductId = productId, InvoiceId = id, Delta = delta, Reason = "invoice-revised" });
            }
        }
    }
    catch (OverflowException) { return Fail("مبلغ یا تعداد از محدودهٔ پشتیبانی‌شده بیشتر است."); }
    if (invoice.Revision == 1 && !await db.InvoiceRevisions.AnyAsync(x => x.InvoiceId == id && x.TenantId == tid))
        db.InvoiceRevisions.Add(new InvoiceRevision { TenantId = tid, InvoiceId = id, RevisionNo = 1, SnapshotJson = oldSnapshot, Reason = "نسخهٔ صادرشده", RecordedAt = invoice.IssuedAt });
    var previousTotal = invoice.TotalRial;
    db.InvoiceLines.RemoveRange(oldLines.Values);
    db.InvoiceLines.AddRange(newLines);
    if (invoice.CustomerName != body.CustomerName.Trim() || invoice.CustomerPhone != revisedPhone)
    {
        var currentCustomer = invoice.CustomerId is Guid currentId
            ? await db.Customers.SingleOrDefaultAsync(x => x.Id == currentId && x.TenantId == tid && !x.Archived) : null;
        if (currentCustomer is not null && currentCustomer.Phone == revisedPhone)
            currentCustomer.Name = body.CustomerName.Trim();
        else
        {
            var matched = await db.Customers.FirstOrDefaultAsync(x => x.TenantId == tid && !x.Archived &&
                x.Phone == revisedPhone && x.Name == body.CustomerName.Trim());
            if (matched is null)
            {
                matched = new Customer { TenantId = tid, Name = body.CustomerName.Trim(), Phone = revisedPhone };
                db.Customers.Add(matched);
            }
            invoice.CustomerId = matched.Id;
        }
    }
    invoice.CustomerName = body.CustomerName.Trim(); invoice.CustomerPhone = revisedPhone;
    invoice.IssuedAt = body.IssuedAt?.ToUniversalTime() ?? invoice.IssuedAt;
    invoice.TotalRial = newTotal; invoice.Revision++;
    FinanceMath.UpdateStatus(invoice);
    var revisedSnapshot = new Invoice { Id = invoice.Id, TenantId = tid, Number = invoice.Number, CustomerId = invoice.CustomerId,
        CustomerName = invoice.CustomerName, CustomerPhone = invoice.CustomerPhone, IssuedAt = invoice.IssuedAt,
        Status = invoice.Status, PaymentStatus = invoice.PaymentStatus, Revision = invoice.Revision,
        TotalRial = invoice.TotalRial, PaidRial = invoice.PaidRial, ReturnedRial = invoice.ReturnedRial,
        RefundedRial = invoice.RefundedRial, Archived = invoice.Archived, IdempotencyKey = invoice.IdempotencyKey,
        BrandSnapshotJson = invoice.BrandSnapshotJson, Lines = newLines };
    db.InvoiceRevisions.Add(new InvoiceRevision { TenantId = tid, InvoiceId = id, RevisionNo = invoice.Revision,
        SnapshotJson = JsonSerializer.Serialize(revisedSnapshot, JsonSerializerOptions.Web), Reason = body.Reason.Trim() });
    Audit(db, c.User, tid, "invoice.revise", "invoice", id, $"from={invoice.Revision - 1};to={invoice.Revision};old={previousTotal};new={newTotal};reason={body.Reason.Trim()}");
    try { await db.SaveChangesAsync(); await tx.CommitAsync(); }
    catch (DbUpdateConcurrencyException) { return Fail("فاکتور هم‌زمان تغییر کرده است؛ دوباره بازش کنید.", 409); }
    catch (DbUpdateException) { return Fail("اصلاح فاکتور ثبت نشد؛ داده‌ها را تازه کنید.", 409); }
    return Results.Ok(new { invoice.Id, invoice.Number, invoice.Revision, invoice.TotalRial, invoice.PaymentStatus });
});
merchant.MapPost("/invoices", async (InvoiceRequest body, MajoraDb db, HttpContext c) =>
{
    if (!CanSell(c.User)) return Results.Forbid();
    var tid = TenantId(c.User);
    if (string.IsNullOrWhiteSpace(body.IdempotencyKey) || body.IdempotencyKey.Length > 100 || body.Lines.Count is < 1 or > 200) return Fail("شناسهٔ درخواست یا اقلام نامعتبر است.");
    var catalogIds = body.Lines.Where(x => x.ProductId is not null).Select(x => x.ProductId).ToList();
    if (catalogIds.Distinct().Count() != catalogIds.Count) return Fail("یک کالا بیش از یک بار در فاکتور انتخاب شده است.");
    if (body.PaymentStatus is not ("paid" or "partial" or "unpaid" or "proforma" or "cheque")) return Fail("وضعیت پرداخت لازم است.");
    if (body.PaymentStatus == "cheque" && (body.Cheque is null || !ValidCheque(body.Cheque) || body.Cheque.Direction != "received")) return Fail("مشخصات چک دریافتی را کامل و درست وارد کنید.");
    if (body.PaymentStatus != "cheque" && body.Cheque is not null) return Fail("اطلاعات چک فقط برای فاکتور چکی پذیرفته می‌شود.");
    if (body.Cheque?.PhotoDataUrl is { Length: > 0 } && !ProductPhotos.TryDecode(body.Cheque.PhotoDataUrl, out _, out _)) return Fail("تصویر چک معتبر نیست.");
    await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
    var existing = await db.Invoices.SingleOrDefaultAsync(x => x.TenantId == tid && x.IdempotencyKey == body.IdempotencyKey);
    if (existing is not null) return Results.Ok(new { existing.Id, existing.Number, existing.TotalRial });
    var chequeSayad = body.Cheque?.SayadId;
    if (!string.IsNullOrWhiteSpace(chequeSayad) && await db.Cheques.AnyAsync(x => x.TenantId == tid && x.SayadId == chequeSayad)) return Fail("این شناسهٔ صیادی قبلاً در فروشگاه ثبت شده است.", 409);
    var tenant = await db.Tenants.SingleAsync(x => x.Id == tid); var customer = body.CustomerId is Guid cid ? await db.Customers.SingleOrDefaultAsync(x => x.Id == cid && x.TenantId == tid && !x.Archived) : null;
    if (body.CustomerId is not null && customer is null) return Fail("مشتری یافت نشد.");
    if (customer is null)
    {
        var newPhone = IranPhone.NormalizeOptional(body.CustomerPhone);
        if (string.IsNullOrWhiteSpace(body.CustomerName) || body.CustomerName.Length > 200 || newPhone is null) return Fail("نام یا شمارهٔ مشتری نامعتبر است؛ شماره تماس باید ۱۱ رقمی باشد.");
        customer = new Customer { TenantId = tid, Name = body.CustomerName.Trim(), Phone = newPhone };
        db.Customers.Add(customer);
    }
    var brandProfile = await db.InvoiceBrands.AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tid)
        ?? InvoiceBrand.Create(tid, tenant.Name, false, null);
    var invoice = new Invoice { TenantId = tid, Number = tenant.NextInvoiceNumber++, CustomerId = customer.Id, CustomerName = customer.Name, CustomerPhone = customer.Phone, PaymentStatus = body.PaymentStatus, IdempotencyKey = body.IdempotencyKey, BrandSnapshotJson = InvoiceBrand.Snapshot(brandProfile) };
    if (string.IsNullOrWhiteSpace(invoice.CustomerName)) return Fail("نام مشتری لازم است.");
    foreach (var item in body.Lines)
    {
        if (item.Quantity < 1 || item.Quantity > 1_000_000) return Fail("تعداد کالا نامعتبر است.");
        if (item.DiscountPercent < 0 || item.DiscountPercent > 100 || decimal.Round(item.DiscountPercent, 3) != item.DiscountPercent) return Fail("درصد تخفیف باید بین صفر تا صد و حداکثر سه رقم اعشار باشد.");
        Product? p = null;
        long unitPrice;
        string name;
        if (item.ProductId is Guid productId)
        {
            p = await db.Products.SingleOrDefaultAsync(x => x.Id == productId && x.TenantId == tid && !x.Archived);
            if (p is null) return Fail("کالا یافت نشد.");
            if (item.ExpectedUnitPriceRial is long expectedPrice && p.PriceRial != expectedPrice) return Fail($"قیمت «{p.Name}» تغییر کرده است؛ فهرست کالا را تازه کنید.", 409);
            if (body.PaymentStatus != "proforma" && p.Stock < item.Quantity) return Fail($"موجودی «{p.Name}» کافی نیست.", 409);
            unitPrice = p.PriceRial;
            name = p.Name;
        }
        else
        {
            if (string.IsNullOrWhiteSpace(item.Name) || item.Name.Trim().Length > 200 || item.UnitPriceRial is not long manualPrice || manualPrice < 0)
                return Fail("نام و قیمت قلم دستی نامعتبر است.");
            unitPrice = manualPrice;
            name = item.Name.Trim();
        }
        var gross = checked(unitPrice * item.Quantity);
        var discount = checked((long)decimal.Round(gross * item.DiscountPercent / 100m, 0, MidpointRounding.AwayFromZero));
        var total = checked(gross - discount); invoice.TotalRial = checked(invoice.TotalRial + total);
        invoice.Lines.Add(new InvoiceLine { ProductId = p?.Id, NameSnapshot = name, UnitPriceRial = unitPrice, Quantity = item.Quantity, TotalRial = total, UnitCostRialSnapshot = p?.AverageCostRial ?? 0, CostKnown = p?.CostKnown ?? false });
        if (body.PaymentStatus != "proforma" && p is not null) { p.Stock -= item.Quantity; db.StockMovements.Add(new StockMovement { TenantId = tid, ProductId = p.Id, InvoiceId = invoice.Id, Delta = -item.Quantity, Reason = "invoice-issued" }); }
    }
    if (body.ExpectedTotalRial is long expectedTotal && expectedTotal != invoice.TotalRial) return Fail("جمع فاکتور با قیمت فعلی کالاها سازگار نیست؛ فهرست را تازه کنید.", 409);
    if (body.PaidRial < 0 || body.PaidRial > invoice.TotalRial || (body.PaymentStatus == "paid" && body.PaidRial != invoice.TotalRial) || (body.PaymentStatus == "partial" && (body.PaidRial <= 0 || body.PaidRial == invoice.TotalRial)) || (body.PaymentStatus is "unpaid" or "proforma" or "cheque" && body.PaidRial != 0)) return Fail("مبلغ پرداخت با وضعیت فاکتور سازگار نیست.");
    if (body.Cheque is { } chequeInput)
    {
        if (chequeInput.AmountRial > invoice.TotalRial || chequeInput.ShowImage && string.IsNullOrWhiteSpace(chequeInput.PhotoDataUrl)) return Fail("مبلغ یا تصویر چک با فاکتور سازگار نیست.");
        var cheque = NewCheque(chequeInput, tid, invoice.Id);
        if (!string.IsNullOrWhiteSpace(chequeInput.PhotoDataUrl) && ProductPhotos.TryDecode(chequeInput.PhotoDataUrl, out var contentType, out var bytes))
        { cheque.PhotoContentType = contentType; cheque.PhotoBytes = bytes; }
        db.Cheques.Add(cheque);
    }
    invoice.PaidRial = body.PaidRial; if (body.PaidRial > 0) db.Payments.Add(new Payment { TenantId = tid, InvoiceId = invoice.Id, AmountRial = body.PaidRial, Method = "initial" });
    if (body.PaymentStatus != "proforma" && invoice.PaidRial < invoice.TotalRial && body.DueAt is DateTime due) db.Reminders.Add(new Reminder { TenantId = tid, InvoiceId = invoice.Id, Title = $"پیگیری مانده فاکتور {invoice.Number}", DueAt = due });
    db.InvoiceRevisions.Add(new InvoiceRevision { TenantId = tid, InvoiceId = invoice.Id, RevisionNo = 1,
        SnapshotJson = JsonSerializer.Serialize(invoice, JsonSerializerOptions.Web), Reason = "نسخهٔ صادرشده", RecordedAt = invoice.IssuedAt });
    db.Invoices.Add(invoice); Audit(db, c.User, tid, "invoice.issue", "invoice", invoice.Id, $"number={invoice.Number}");
    try { await db.SaveChangesAsync(); await tx.CommitAsync(); }
    catch (DbUpdateException) { return Fail("هم‌زمانی در ثبت رخ داد؛ درخواست را دوباره بررسی کنید.", 409); }
    return Results.Created($"/api/merchant/invoices/{invoice.Id}", new { invoice.Id, invoice.Number, invoice.TotalRial, invoice.PaidRial });
});
merchant.MapPost("/invoices/{id:guid}/convert", async (Guid id, MajoraDb db, HttpContext c) =>
{
    if (!CanSell(c.User)) return Results.Forbid();
    var tid = TenantId(c.User);
    await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
    var invoice = await db.Invoices.Include(x => x.Lines).SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tid && !x.Archived && x.Status == "issued");
    if (invoice is null) return Results.NotFound();
    if (invoice.PaymentStatus != "proforma") return Fail("این سند دیگر پیش‌فاکتور فعال نیست.", 409);
    if (invoice.Revision == 1 && !await db.InvoiceRevisions.AnyAsync(x => x.InvoiceId == id && x.TenantId == tid))
        db.InvoiceRevisions.Add(new InvoiceRevision { TenantId = tid, InvoiceId = id, RevisionNo = 1,
            SnapshotJson = JsonSerializer.Serialize(invoice, JsonSerializerOptions.Web), Reason = "نسخهٔ پیش‌فاکتور", RecordedAt = invoice.IssuedAt });
    foreach (var line in invoice.Lines)
    {
        if (line.ProductId is not Guid productId) continue;
        var product = await db.Products.SingleOrDefaultAsync(x => x.Id == productId && x.TenantId == tid && !x.Archived);
        if (product is null || product.Stock < line.Quantity) return Fail($"موجودی «{line.NameSnapshot}» برای تبدیل پیش‌فاکتور کافی نیست.", 409);
        product.Stock = checked(product.Stock - line.Quantity);
        line.UnitCostRialSnapshot = product.AverageCostRial;
        line.CostKnown = product.CostKnown;
        db.StockMovements.Add(new StockMovement { TenantId = tid, ProductId = productId, InvoiceId = invoice.Id, Delta = -line.Quantity, Reason = "proforma-converted" });
    }
    invoice.PaymentStatus = invoice.TotalRial == 0 ? "paid" : "unpaid";
    invoice.Revision++;
    db.InvoiceRevisions.Add(new InvoiceRevision { TenantId = tid, InvoiceId = id, RevisionNo = invoice.Revision,
        SnapshotJson = JsonSerializer.Serialize(invoice, JsonSerializerOptions.Web), Reason = "تبدیل پیش‌فاکتور به فروش" });
    Audit(db, c.User, tid, "invoice.convert-proforma", "invoice", invoice.Id, $"number={invoice.Number}");
    try { await db.SaveChangesAsync(); await tx.CommitAsync(); }
    catch (DbUpdateConcurrencyException) { return Fail("پیش‌فاکتور هم‌زمان تغییر کرده است؛ دوباره بازش کنید.", 409); }
    catch (DbUpdateException) { return Fail("هم‌زمانی در تبدیل رخ داد؛ موجودی را بررسی کنید.", 409); }
    return Results.Ok(new { invoice.Id, invoice.Number, invoice.Revision, invoice.TotalRial, invoice.PaymentStatus });
});
merchant.MapPost("/invoices/{id:guid}/payments", async (Guid id, PaymentRequest body, MajoraDb db, HttpContext c) =>
{
    if (!CanSell(c.User)) return Results.Forbid();
    if (string.IsNullOrWhiteSpace(body.IdempotencyKey) || body.IdempotencyKey.Length > 100) return Fail("شناسهٔ ثبت دریافت لازم است.");
    await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
    var tid = TenantId(c.User);
    var existing = await db.Payments.SingleOrDefaultAsync(x => x.TenantId == tid && x.IdempotencyKey == body.IdempotencyKey);
    if (existing is not null) return existing.InvoiceId == id ? Results.Ok(new { existing.Id, existing.AmountRial }) : Fail("شناسهٔ درخواست برای فاکتور دیگری استفاده شده است.", 409);
    var invoice = await db.Invoices.SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tid && x.Status == "issued" && x.PaymentStatus != "proforma"); if (invoice is null) return Results.NotFound();
    if (await db.Cheques.AnyAsync(x => x.TenantId == tid && x.InvoiceId == id && x.Status == "open")) return Fail("چک این فاکتور هنوز باز است؛ ابتدا وضعیت چک را مشخص کنید.", 409);
    if (body.AmountRial < 1 || body.AmountRial > FinanceMath.Receivable(invoice) || string.IsNullOrWhiteSpace(body.Method)) return Fail("مبلغ از مانده بیشتر است یا معتبر نیست.");
    var payment = new Payment { TenantId = invoice.TenantId, InvoiceId = id, IdempotencyKey = body.IdempotencyKey, AmountRial = body.AmountRial, Method = body.Method.Trim(), Reference = body.Reference?.Trim() ?? "" };
    invoice.PaidRial = checked(invoice.PaidRial + body.AmountRial); FinanceMath.UpdateStatus(invoice);
    if (invoice.PaymentStatus == "paid") foreach (var reminder in await db.Reminders.Where(x => x.InvoiceId == id && x.TenantId == invoice.TenantId && !x.Done).ToListAsync()) reminder.Done = true;
    db.Payments.Add(payment); Audit(db, c.User, invoice.TenantId, "payment.record", "invoice", id, $"amount={body.AmountRial}");
    try { await db.SaveChangesAsync(); await tx.CommitAsync(); }
    catch (DbUpdateException) { return Fail("دریافت هم‌زمان ثبت شد؛ فاکتور را تازه کنید.", 409); }
    return Results.Ok(new { payment.Id, invoice.PaidRial, invoice.PaymentStatus });
});
merchant.MapGet("/accounting/returns", async (string? q, MajoraDb db, HttpContext c) =>
{
    var tid = TenantId(c.User);
    return Results.Ok(await db.SalesReturns.AsNoTracking().Where(x => x.TenantId == tid &&
        (q == null || x.Reason.Contains(q) || db.Invoices.Any(i => i.Id == x.InvoiceId && (i.CustomerName.Contains(q) || i.Number.ToString() == q))))
        .OrderByDescending(x => x.CreatedAt).Take(100)
        .Select(x => new { x.Id, x.InvoiceId, x.Reason, x.AmountRial, x.CreatedAt,
            InvoiceNumber = db.Invoices.Where(i => i.Id == x.InvoiceId).Select(i => i.Number).FirstOrDefault(),
            CustomerName = db.Invoices.Where(i => i.Id == x.InvoiceId).Select(i => i.CustomerName).FirstOrDefault() }).ToListAsync());
});
merchant.MapPost("/invoices/{id:guid}/returns", async (Guid id, SalesReturnRequest body, MajoraDb db, HttpContext c) =>
{
    if (!CanSell(c.User)) return Results.Forbid();
    if (body.Lines is null || body.Lines.Count is < 1 or > 200 ||
        string.IsNullOrWhiteSpace(body.IdempotencyKey) || body.IdempotencyKey.Length > 100 ||
        string.IsNullOrWhiteSpace(body.Reason) || body.Reason.Length > 500 ||
        body.Lines.Select(x => x.InvoiceLineId).Distinct().Count() != body.Lines.Count)
        return Fail("ردیف‌ها، دلیل یا شناسهٔ مرجوعی نامعتبر است.");
    var tid = TenantId(c.User);
    await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
    var existing = await db.SalesReturns.SingleOrDefaultAsync(x => x.TenantId == tid && x.IdempotencyKey == body.IdempotencyKey);
    if (existing is not null) return existing.InvoiceId == id ? Results.Ok(new { existing.Id, existing.AmountRial }) : Fail("شناسهٔ درخواست برای فاکتور دیگری استفاده شده است.", 409);
    if (await db.Cheques.AnyAsync(x => x.TenantId == tid && x.InvoiceId == id && x.Status == "open")) return Fail("پیش از ثبت مرجوعی، وضعیت چک باز فاکتور را تعیین کنید.", 409);
    var invoice = await db.Invoices.Include(x => x.Lines).SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tid && x.Status == "issued" && x.PaymentStatus != "proforma");
    if (invoice is null) return Results.NotFound();
    var salesReturn = new SalesReturn { TenantId = tid, InvoiceId = id, IdempotencyKey = body.IdempotencyKey, Reason = body.Reason.Trim() };
    foreach (var item in body.Lines)
    {
        var line = invoice.Lines.SingleOrDefault(x => x.Id == item.InvoiceLineId);
        if (line is null || item.Quantity < 1 || item.Quantity > line.Quantity - line.ReturnedQuantity)
            return Fail("تعداد مرجوعی از مقدار باقی‌مانده بیشتر است یا ردیف معتبر نیست.");
        // Allocate the frozen net line amount across partial returns. The last return
        // receives the rounding remainder, so all returns sum to exactly the sale amount.
        static long ReturnedValue(InvoiceLine saleLine, long quantity) =>
            checked((long)decimal.Round((decimal)saleLine.TotalRial * quantity / saleLine.Quantity, 0, MidpointRounding.AwayFromZero));
        var amount = checked(ReturnedValue(line, line.ReturnedQuantity + item.Quantity) - ReturnedValue(line, line.ReturnedQuantity));
        line.ReturnedQuantity = checked(line.ReturnedQuantity + item.Quantity);
        salesReturn.AmountRial = checked(salesReturn.AmountRial + amount);
        salesReturn.Lines.Add(new SalesReturnLine { InvoiceLineId = line.Id, ProductId = line.ProductId,
            NameSnapshot = line.NameSnapshot, Quantity = item.Quantity, AmountRial = amount,
            UnitCostRialSnapshot = line.UnitCostRialSnapshot, CostKnown = line.CostKnown, Restocked = item.Restock });
        if (item.Restock)
        {
            if (line.ProductId is not Guid productId) return Fail("ردیف بدون کالا را نمی‌توان به انبار برگرداند.");
            var product = await db.Products.SingleOrDefaultAsync(x => x.Id == productId && x.TenantId == tid);
            if (product is null) return Fail("کالای مرجوعی در انبار یافت نشد.");
            product.Stock = checked(product.Stock + item.Quantity); product.UpdatedAt = DateTime.UtcNow;
            db.StockMovements.Add(new StockMovement { TenantId = tid, ProductId = product.Id, InvoiceId = id, Delta = item.Quantity, Reason = "sales-return" });
        }
    }
    invoice.ReturnedRial = checked(invoice.ReturnedRial + salesReturn.AmountRial);
    if (invoice.ReturnedRial > invoice.TotalRial) return Fail("جمع مرجوعی از مبلغ فاکتور بیشتر است.");
    FinanceMath.UpdateStatus(invoice);
    if (FinanceMath.Receivable(invoice) == 0)
        foreach (var reminder in await db.Reminders.Where(x => x.InvoiceId == id && x.TenantId == tid && !x.Done).ToListAsync()) reminder.Done = true;
    if (FinanceMath.RefundDue(invoice) > 0)
        db.Reminders.Add(new Reminder { TenantId = tid, InvoiceId = id, Title = $"بازپرداخت مشتری فاکتور {invoice.Number}", DueAt = DateTime.UtcNow });
    db.SalesReturns.Add(salesReturn);
    Audit(db, c.User, tid, "sales-return.record", "invoice", id, $"return={salesReturn.Id};amount={salesReturn.AmountRial}");
    try { await db.SaveChangesAsync(); await tx.CommitAsync(); }
    catch (DbUpdateException) { return Fail("مرجوعی هم‌زمان ثبت شد؛ داده‌ها را تازه کنید.", 409); }
    return Results.Created($"/api/merchant/accounting/returns/{salesReturn.Id}", new { salesReturn.Id, salesReturn.AmountRial, invoice.ReturnedRial, invoice.PaymentStatus, refundDueRial = FinanceMath.RefundDue(invoice) });
});
merchant.MapPost("/invoices/{id:guid}/refunds", async (Guid id, RefundRequest body, MajoraDb db, HttpContext c) =>
{
    if (!CanSell(c.User)) return Results.Forbid();
    if (string.IsNullOrWhiteSpace(body.IdempotencyKey) || body.IdempotencyKey.Length > 100 || string.IsNullOrWhiteSpace(body.Method)) return Fail("شناسه یا روش بازپرداخت لازم است.");
    var tid = TenantId(c.User);
    await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
    var existing = await db.Refunds.SingleOrDefaultAsync(x => x.TenantId == tid && x.IdempotencyKey == body.IdempotencyKey);
    if (existing is not null) return existing.InvoiceId == id ? Results.Ok(new { existing.Id, existing.AmountRial }) : Fail("شناسهٔ درخواست برای فاکتور دیگری استفاده شده است.", 409);
    var invoice = await db.Invoices.SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tid && x.Status == "issued");
    if (invoice is null) return Results.NotFound();
    if (body.AmountRial < 1 || body.AmountRial > FinanceMath.RefundDue(invoice)) return Fail("مبلغ بازپرداخت از طلب مشتری بیشتر است یا معتبر نیست.");
    var refund = new Refund { TenantId = tid, InvoiceId = id, IdempotencyKey = body.IdempotencyKey, AmountRial = body.AmountRial, Method = body.Method.Trim(), Reference = body.Reference?.Trim() ?? "" };
    invoice.RefundedRial = checked(invoice.RefundedRial + body.AmountRial); FinanceMath.UpdateStatus(invoice);
    if (FinanceMath.RefundDue(invoice) == 0)
        foreach (var reminder in await db.Reminders.Where(x => x.InvoiceId == id && x.TenantId == tid && !x.Done && x.Title.StartsWith("بازپرداخت")).ToListAsync()) reminder.Done = true;
    db.Refunds.Add(refund); Audit(db, c.User, tid, "refund.record", "invoice", id, $"amount={body.AmountRial}");
    try { await db.SaveChangesAsync(); await tx.CommitAsync(); }
    catch (DbUpdateException) { return Fail("بازپرداخت هم‌زمان ثبت شد؛ داده‌ها را تازه کنید.", 409); }
    return Results.Created($"/api/merchant/invoices/{id}", new { refund.Id, invoice.RefundedRial, invoice.PaymentStatus, refundDueRial = FinanceMath.RefundDue(invoice) });
});
merchant.MapGet("/reminders", async (MajoraDb db, HttpContext c) => { var tid = TenantId(c.User); return Results.Ok(await db.Reminders.Where(x => x.TenantId == tid && !x.Done).OrderBy(x => x.DueAt).Take(100).ToListAsync()); });
merchant.MapPost("/reminders", async (ReminderRequest body, MajoraDb db, HttpContext c) => { if (string.IsNullOrWhiteSpace(body.Title)) return Fail("عنوان یادآور لازم است."); var r = new Reminder { TenantId = TenantId(c.User), Title = body.Title.Trim(), DueAt = body.DueAt }; db.Reminders.Add(r); Audit(db, c.User, r.TenantId, "reminder.create", "reminder", r.Id); await db.SaveChangesAsync(); return Results.Created($"/api/merchant/reminders/{r.Id}", r); });
merchant.MapPut("/reminders/{id:guid}", async (Guid id, ReminderRequest body, MajoraDb db, HttpContext c) =>
{
    if (!CanWrite(c.User)) return Results.Forbid();
    if (string.IsNullOrWhiteSpace(body.Title) || body.Title.Length > 300 || body.DueAt.Year is < 2000 or > 2100)
        return Fail("عنوان یا تاریخ یادآور معتبر نیست.");
    var tid = TenantId(c.User);
    var reminder = await db.Reminders.SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tid);
    if (reminder is null) return Results.NotFound();
    var oldTitle = reminder.Title; var oldDueAt = reminder.DueAt;
    reminder.Title = body.Title.Trim(); reminder.DueAt = body.DueAt.ToUniversalTime();
    Audit(db, c.User, tid, "reminder.update", "reminder", id,
        JsonSerializer.Serialize(new { oldTitle, newTitle = reminder.Title, oldDueAt, newDueAt = reminder.DueAt }));
    await db.SaveChangesAsync(); return Results.Ok(reminder);
});
merchant.MapPost("/reminders/{id:guid}/done", async (Guid id, MajoraDb db, HttpContext c) => { var tid = TenantId(c.User); var r = await db.Reminders.SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tid); if (r is null) return Results.NotFound(); r.Done = true; Audit(db, c.User, r.TenantId, "reminder.done", "reminder", id); await db.SaveChangesAsync(); return Results.NoContent(); });
merchant.MapGet("/staff", async (MajoraDb db, HttpContext c) => { var tid = TenantId(c.User); return Results.Ok(await db.Users.Where(x => x.TenantId == tid).Select(x => new { x.Id, x.Username, x.DisplayName, x.Role, x.Enabled }).ToListAsync()); });
merchant.MapGet("/activity", async (int? page, string? q, MajoraDb db, HttpContext c) =>
{
    if (Role(c.User) != "owner") return Results.Forbid();
    var tid = TenantId(c.User);
    var search = q?.Trim();
    if (search?.Length > 100) return Fail("عبارت جست‌وجو نباید بیش از ۱۰۰ نویسه باشد.");
    var events = db.Audit.AsNoTracking().Where(x => x.TenantId == tid)
        .Join(db.Users.AsNoTracking().Where(x => x.TenantId == tid), a => a.ActorId, u => u.Id,
            (a, u) => new { a.Id, a.At, a.Action, a.EntityType, a.EntityId, a.Detail, ActorName = u.Username });
    if (!string.IsNullOrEmpty(search)) events = events.Where(x => x.ActorName.Contains(search) || x.Action.Contains(search) || x.EntityType.Contains(search) || x.EntityId.Contains(search) || x.Detail.Contains(search));
    return Results.Ok(await events.OrderByDescending(x => x.At).Skip(Math.Max(0, (page ?? 1) - 1) * 100).Take(100).ToListAsync());
});
merchant.MapPut("/staff/{id:guid}/username", async (Guid id, UsernameUpdate body, MajoraDb db, HttpContext c) =>
{
    if (Role(c.User) != "owner") return Results.Forbid();
    var newName = body.Username?.Trim();
    if (string.IsNullOrWhiteSpace(newName) || newName.Length > 100) return Fail("نام کاربری باید بین ۱ تا ۱۰۰ نویسه باشد.");
    var tid = TenantId(c.User);
    var user = await db.Users.SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tid && x.Role != "owner");
    if (user is null) return Results.NotFound();
    if (user.Username == newName) return Results.Ok(new { user.Id, user.Username });
    if (await db.Users.AnyAsync(x => x.Username == newName)) return Fail("این نام کاربری قبلاً استفاده شده است.", 409);
    var oldName = user.Username; user.Username = newName; user.AuthVersion++;
    Audit(db, c.User, tid, "staff.username.update", "user", id, $"old={oldName};new={newName}");
    try { await db.SaveChangesAsync(); } catch (DbUpdateException) { return Fail("این نام کاربری هم‌زمان ثبت شده است.", 409); }
    return Results.Ok(new { user.Id, user.Username });
});
merchant.MapPost("/staff/{id:guid}/reset-password", async (Guid id, PasswordReset body, MajoraDb db, IPasswordHasher<AppUser> hasher, HttpContext c) =>
{
    if (Role(c.User) != "owner") return Results.Forbid();
    if (string.IsNullOrWhiteSpace(body.NewPassword) || body.NewPassword.Length < 12) return Fail("رمز جدید باید حداقل ۱۲ نویسه باشد.");
    var tid = TenantId(c.User);
    var user = await db.Users.SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tid && x.Role != "owner");
    if (user is null) return Results.NotFound();
    user.PasswordHash = hasher.HashPassword(user, body.NewPassword); user.AuthVersion++;
    Audit(db, c.User, tid, "password.owner-reset", "user", id);
    await db.SaveChangesAsync(); return Results.NoContent();
});
merchant.MapPost("/staff", async (StaffRequest body, MajoraDb db, IPasswordHasher<AppUser> hasher, HttpContext c) =>
{
    if (Role(c.User) != "owner") return Results.Forbid();
    if (body.Role is not ("manager" or "staff") || body.Password.Length < 12 || string.IsNullOrWhiteSpace(body.Username)) return Fail("مشخصات کاربر نامعتبر است.");
    var tid = TenantId(c.User); var activePlan = await db.Subscriptions.Where(x => x.TenantId == tid && x.PaymentStatus == "paid" && x.EndsAt > DateTime.UtcNow).OrderByDescending(x => x.EndsAt).Join(db.Plans, x => x.PlanId, p => p.Id, (x,p) => p).FirstAsync();
    if (await db.Users.CountAsync(x => x.TenantId == tid && x.Enabled) >= activePlan.MaxUsers) return Fail("سقف کاربران طرح تکمیل است.", 409);
    if (await db.Users.AnyAsync(x => x.Username == body.Username)) return Fail("نام کاربری تکراری است.", 409);
    var user = new AppUser { TenantId = tid, Username = body.Username.Trim(), DisplayName = body.DisplayName.Trim(), Role = body.Role };
    user.PasswordHash = hasher.HashPassword(user, body.Password); db.Users.Add(user); Audit(db, c.User, tid, "staff.create", "user", user.Id); await db.SaveChangesAsync(); return Results.Created($"/api/merchant/staff/{user.Id}", new { user.Id, user.Username, user.DisplayName, user.Role });
});
merchant.MapPost("/staff/{id:guid}/enabled", async (Guid id, EnabledRequest body, MajoraDb db, HttpContext c) =>
{
    if (Role(c.User) != "owner") return Results.Forbid();
    var tid = TenantId(c.User); var user = await db.Users.SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tid && x.Role != "owner");
    if (user is null) return Results.NotFound();
    if (body.Enabled && !user.Enabled)
    {
        var maxUsers = await db.Subscriptions.Where(x => x.TenantId == tid && x.PaymentStatus == "paid" && x.EndsAt > DateTime.UtcNow)
            .OrderByDescending(x => x.EndsAt).Join(db.Plans, x => x.PlanId, p => p.Id, (x, p) => p.MaxUsers).FirstAsync();
        if (await db.Users.CountAsync(x => x.TenantId == tid && x.Enabled) >= maxUsers) return Fail("سقف کاربران طرح تکمیل است.", 409);
    }
    user.Enabled = body.Enabled; user.AuthVersion++;
    Audit(db, c.User, user.TenantId, "staff.enabled", "user", id, $"enabled={body.Enabled}");
    await db.SaveChangesAsync(); return Results.NoContent();
});
merchant.MapGet("/accounting/overview", async (MajoraDb db, HttpContext c) =>
{
    var tid = TenantId(c.User); var since = DateTime.UtcNow.AddDays(-30);
    var sales = await db.Invoices.Include(x => x.Lines).Where(x => x.TenantId == tid && x.Status == "issued" && x.PaymentStatus != "proforma" && x.IssuedAt >= since).ToListAsync();
    var returns = await db.SalesReturns.Include(x => x.Lines).Where(x => x.TenantId == tid && x.CreatedAt >= since).ToListAsync();
    var openInvoices = await db.Invoices.Where(x => x.TenantId == tid && x.Status == "issued" && x.PaymentStatus != "proforma").ToListAsync();
    var purchases = await db.Purchases.Where(x => x.TenantId == tid && x.PurchasedAt >= since).ToListAsync();
    var expenses = await db.Expenses.Where(x => x.TenantId == tid && !x.Voided && x.IncurredAt >= since).ToListAsync();
    var costComplete = sales.SelectMany(x => x.Lines).All(x => x.CostKnown) && returns.SelectMany(x => x.Lines).All(x => x.CostKnown);
    var metrics = FinanceMath.SummarizeSales(sales, returns.Sum(x => x.AmountRial), openInvoices);
    var revenue = metrics.NetSalesRial;
    var cogs = costComplete ? checked(sales.SelectMany(x => x.Lines).Sum(x => checked(x.UnitCostRialSnapshot * x.Quantity)) - returns.SelectMany(x => x.Lines).Sum(x => checked(x.UnitCostRialSnapshot * x.Quantity))) : (long?)null;
    var received = await db.Payments.Where(x => x.TenantId == tid && x.ReceivedAt >= since).SumAsync(x => x.AmountRial);
    var refunded = await db.Refunds.Where(x => x.TenantId == tid && x.RefundedAt >= since).SumAsync(x => x.AmountRial);
    return Results.Ok(new { periodDays = 30, revenueRial = revenue, returnsRial = metrics.ReturnsRial, receivedRial = received - refunded, refundedRial = refunded, customerReceivableRial = metrics.ReceivableRial, refundDueRial = metrics.RefundDueRial, purchasesRial = purchases.Sum(x => x.TotalRial), supplierPayableRial = purchases.Sum(x => x.TotalRial - x.PaidRial), expensesRial = expenses.Sum(x => x.AmountRial), costComplete, costOfGoodsSoldRial = cogs, estimatedOperatingRial = cogs is null ? null : (long?)(revenue - cogs.Value - expenses.Sum(x => x.AmountRial)), note = "برآورد ۳۰روزهٔ عملیاتی است؛ مالیات، استهلاک و ماندهٔ ابتدای دوره در آن نیست. طلب و بازپرداخت، ماندهٔ باز همهٔ فاکتورهاست." });
});
merchant.MapGet("/accounting/cheques", async (string? q, string? status, string? direction, MajoraDb db, HttpContext c) =>
{
    var tid = TenantId(c.User);
    var query = db.Cheques.AsNoTracking().Where(x => x.TenantId == tid);
    if (!string.IsNullOrWhiteSpace(status) && status != "all") query = query.Where(x => x.Status == status);
    if (direction is "received" or "issued") query = query.Where(x => x.Direction == direction);
    if (!string.IsNullOrWhiteSpace(q)) query = query.Where(x => x.Party.Contains(q) || x.Serial.Contains(q) || x.Bank.Contains(q) || x.SayadId.Contains(q));
    return Results.Ok(await query.OrderBy(x => x.Status == "open" ? 0 : 1).ThenBy(x => x.DueAt).Take(200)
        .Select(x => new { x.Id, x.InvoiceId, InvoiceNumber = x.InvoiceId == null ? (long?)null : db.Invoices.Where(i => i.Id == x.InvoiceId && i.TenantId == tid).Select(i => (long?)i.Number).FirstOrDefault(),
            x.Direction, x.Party, x.Serial, x.Bank, x.AmountRial, x.DueAt, x.SayadId, x.IssuerNationalId, x.BeneficiaryNationalId,
            x.RegistrationStatus, x.Status, x.Note, x.ShowDetails, x.ShowImage, HasPhoto = x.PhotoBytes != null, x.CreatedAt, x.UpdatedAt }).ToListAsync());
});
merchant.MapGet("/accounting/cheques/overview", async (MajoraDb db, HttpContext c) =>
{
    var tid = TenantId(c.User);
    var groups = await db.Cheques.AsNoTracking().Where(x => x.TenantId == tid)
        .GroupBy(x => new { x.Direction, x.Status }).Select(g => new { g.Key.Direction, g.Key.Status, Count = g.Count(), AmountRial = g.Sum(x => x.AmountRial) }).ToListAsync();
    return Results.Ok(new { groups,
        overdueReceivedCount = await db.Cheques.CountAsync(x => x.TenantId == tid && x.Direction == "received" && x.Status == "open" && x.DueAt <= DateTime.UtcNow),
        overdueIssuedCount = await db.Cheques.CountAsync(x => x.TenantId == tid && x.Direction == "issued" && x.Status == "open" && x.DueAt <= DateTime.UtcNow) });
});
merchant.MapPost("/accounting/cheques", async (ChequeRequest body, MajoraDb db, HttpContext c) =>
{
    if (!CanWrite(c.User)) return Results.Forbid();
    if (!ValidCheque(body) || body.ShowDetails || body.ShowImage || !string.IsNullOrWhiteSpace(body.PhotoDataUrl) && !ProductPhotos.TryDecode(body.PhotoDataUrl, out _, out _)) return Fail("مشخصات چک مستقل نامعتبر است.");
    var tid = TenantId(c.User); var cheque = NewCheque(body, tid);
    if (cheque.SayadId.Length > 0 && await db.Cheques.AnyAsync(x => x.TenantId == tid && x.SayadId == cheque.SayadId)) return Fail("این شناسهٔ صیادی قبلاً در فروشگاه ثبت شده است.", 409);
    if (!string.IsNullOrWhiteSpace(body.PhotoDataUrl) && ProductPhotos.TryDecode(body.PhotoDataUrl, out var contentType, out var bytes))
    { cheque.PhotoContentType = contentType; cheque.PhotoBytes = bytes; }
    db.Cheques.Add(cheque); Audit(db, c.User, tid, "cheque.create", "cheque", cheque.Id);
    try { await db.SaveChangesAsync(); } catch (DbUpdateException) { return Fail("چک تکراری است یا هم‌زمان تغییر کرده است.", 409); }
    return Results.Created($"/api/merchant/accounting/cheques/{cheque.Id}", new { cheque.Id });
});
merchant.MapPut("/accounting/cheques/{id:guid}", async (Guid id, ChequeRequest body, MajoraDb db, HttpContext c) =>
{
    if (!CanWrite(c.User)) return Results.Forbid();
    if (!ValidCheque(body)) return Fail("مشخصات چک نامعتبر است.");
    var tid = TenantId(c.User); await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
    var cheque = await db.Cheques.SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tid);
    if (cheque is null) return Results.NotFound();
    if (cheque.Status != "open") return Fail("پروندهٔ بسته‌شده را نمی‌توان بی‌سابقه ویرایش کرد.", 409);
    if (!string.IsNullOrWhiteSpace(body.SayadId) && await db.Cheques.AnyAsync(x => x.TenantId == tid && x.Id != id && x.SayadId == body.SayadId)) return Fail("این شناسهٔ صیادی قبلاً در فروشگاه ثبت شده است.", 409);
    if (cheque.Direction != body.Direction || cheque.InvoiceId is not null && (body.Direction != "received" || body.AmountRial > await db.Invoices.Where(i => i.Id == cheque.InvoiceId && i.TenantId == tid).Select(i => i.TotalRial - i.ReturnedRial - i.PaidRial + i.RefundedRial).SingleAsync())) return Fail("نوع یا مبلغ چک با فاکتور ناسازگار است.", 409);
    if (body.PhotoDataUrl is { Length: > 0 } && !ProductPhotos.TryDecode(body.PhotoDataUrl, out _, out _)) return Fail("تصویر چک معتبر نیست.");
    if (body.ShowImage && body.PhotoDataUrl is null && cheque.PhotoBytes is null) return Fail("برای چاپ تصویر، ابتدا عکس چک را ثبت کنید.");
    cheque.Party = body.Party.Trim(); cheque.Serial = body.Serial.Trim(); cheque.Bank = body.Bank.Trim(); cheque.AmountRial = body.AmountRial;
    cheque.DueAt = body.DueAt.ToUniversalTime(); cheque.SayadId = body.SayadId?.Trim() ?? ""; cheque.IssuerNationalId = body.IssuerNationalId?.Trim() ?? "";
    cheque.BeneficiaryNationalId = body.BeneficiaryNationalId?.Trim() ?? ""; cheque.RegistrationStatus = body.RegistrationStatus;
    cheque.Note = body.Note?.Trim() ?? ""; cheque.ShowDetails = cheque.InvoiceId is not null && body.ShowDetails; cheque.ShowImage = cheque.InvoiceId is not null && body.ShowImage;
    if (body.PhotoDataUrl == "") { cheque.PhotoBytes = null; cheque.PhotoContentType = null; cheque.ShowImage = false; }
    else if (body.PhotoDataUrl is { Length: > 0 } && ProductPhotos.TryDecode(body.PhotoDataUrl, out var contentType, out var bytes))
    { cheque.PhotoBytes = bytes; cheque.PhotoContentType = contentType; }
    cheque.UpdatedAt = DateTime.UtcNow; Audit(db, c.User, tid, "cheque.update", "cheque", id);
    try { await db.SaveChangesAsync(); await tx.CommitAsync(); }
    catch (DbUpdateException) { return Fail("چک تکراری است یا هم‌زمان تغییر کرده است.", 409); }
    return Results.Ok(new { cheque.Id });
});
merchant.MapGet("/accounting/cheques/{id:guid}/photo", async (Guid id, MajoraDb db, HttpContext c) =>
{
    var tid = TenantId(c.User); var cheque = await db.Cheques.AsNoTracking().Where(x => x.Id == id && x.TenantId == tid && x.PhotoBytes != null)
        .Select(x => new { x.PhotoBytes, x.PhotoContentType }).SingleOrDefaultAsync();
    c.Response.Headers.CacheControl = "no-store";
    return cheque?.PhotoBytes is { } bytes ? Results.File(bytes, cheque.PhotoContentType ?? "image/jpeg") : Results.NotFound();
});
merchant.MapPost("/accounting/cheques/{id:guid}/status", async (Guid id, ChequeStatusRequest body, MajoraDb db, HttpContext c) =>
{
    if (!CanWrite(c.User)) return Results.Forbid();
    if (body.Status is not ("open" or "cleared" or "returned" or "cancelled")) return Fail("وضعیت چک نامعتبر است.");
    var tid = TenantId(c.User); await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
    var cheque = await db.Cheques.SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tid);
    if (cheque is null) return Results.NotFound();
    if (cheque.Status == body.Status) return Fail("وضعیت چک تغییری نکرده است.", 409);
    if (cheque.Status != "open" && (string.IsNullOrWhiteSpace(body.Reason) || body.Reason.Length > 500))
        return Fail("برای اصلاح وضعیت ثبت‌شده، دلیل اصلاح لازم است.");
    var oldStatus = cheque.Status;
    if (cheque.InvoiceId is Guid invoiceId)
    {
        var invoice = await db.Invoices.SingleAsync(x => x.Id == invoiceId && x.TenantId == tid);
        if (oldStatus == "cleared")
        {
            if (invoice.PaidRial < cheque.AmountRial) return Fail("دریافتی فاکتور با مبلغ چک سازگار نیست؛ پرونده را بررسی کنید.", 409);
            invoice.PaidRial -= cheque.AmountRial;
            db.Payments.Add(new Payment { TenantId = tid, InvoiceId = invoiceId, AmountRial = -cheque.AmountRial,
                Method = "cheque-reversal", Reference = cheque.Serial, IdempotencyKey = $"cheque-reversal-{cheque.Id}-{Guid.NewGuid():N}" });
        }
        if (body.Status == "cleared")
        {
            if (cheque.AmountRial > FinanceMath.Receivable(invoice)) return Fail("مبلغ چک از ماندهٔ قابل دریافت بیشتر است؛ پرونده را بررسی کنید.", 409);
            invoice.PaidRial = checked(invoice.PaidRial + cheque.AmountRial);
            db.Payments.Add(new Payment { TenantId = tid, InvoiceId = invoiceId, AmountRial = cheque.AmountRial, Method = "cheque", Reference = cheque.Serial, IdempotencyKey = $"cheque-{cheque.Id}-{Guid.NewGuid():N}" });
        }
        FinanceMath.UpdateStatus(invoice);
        if (invoice.PaymentStatus == "paid") foreach (var reminder in await db.Reminders.Where(x => x.TenantId == tid && x.InvoiceId == invoiceId && !x.Done).ToListAsync()) reminder.Done = true;
    }
    cheque.Status = body.Status; cheque.UpdatedAt = DateTime.UtcNow;
    Audit(db, c.User, tid, "cheque.status", "cheque", id,
        JsonSerializer.Serialize(new { oldStatus, newStatus = body.Status, reason = body.Reason?.Trim() ?? "" }));
    try { await db.SaveChangesAsync(); await tx.CommitAsync(); }
    catch (DbUpdateException) { return Fail("وضعیت چک هم‌زمان تغییر کرده است؛ فهرست را تازه کنید.", 409); }
    return Results.Ok(new { cheque.Id, cheque.Status });
});
merchant.MapGet("/accounting/purchases", async (MajoraDb db, HttpContext c) => { var tid = TenantId(c.User); return Results.Ok(await db.Purchases.Where(x => x.TenantId == tid).OrderByDescending(x => x.PurchasedAt).Take(100).Select(x => new { x.Id, x.SupplierName, x.SupplierInvoiceNumber, x.PurchasedAt, x.TotalRial, x.PaidRial }).ToListAsync()); });
merchant.MapPost("/accounting/purchases", async (PurchaseRequest body, MajoraDb db, HttpContext c) =>
{
    if (!CanWrite(c.User)) return Results.Forbid();
    if (string.IsNullOrWhiteSpace(body.SupplierName) || string.IsNullOrWhiteSpace(body.IdempotencyKey) || body.IdempotencyKey.Length > 100 || body.Lines is null || body.Lines.Count is < 1 or > 100) return Fail("اطلاعات خرید نامعتبر است.");
    var tid = TenantId(c.User); await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
    var existing = await db.Purchases.SingleOrDefaultAsync(x => x.TenantId == tid && x.IdempotencyKey == body.IdempotencyKey);
    if (existing is not null) return Results.Ok(new { existing.Id, existing.TotalRial });
    if (body.PurchasedAt is DateTime purchaseDate && (purchaseDate > DateTime.UtcNow.AddDays(1) || purchaseDate < new DateTime(2000, 1, 1)))
        return Fail("تاریخ خرید معتبر نیست.");
    var purchase = new Purchase { TenantId = tid, SupplierName = body.SupplierName.Trim(), SupplierInvoiceNumber = body.SupplierInvoiceNumber?.Trim() ?? "", IdempotencyKey = body.IdempotencyKey,
        PurchasedAt = body.PurchasedAt?.ToUniversalTime() ?? DateTime.UtcNow };
    var newSkus = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    foreach (var item in body.Lines)
    {
        if (item.Quantity < 1 || item.Quantity > 1_000_000 || item.UnitCostRial < 0 ||
            item.StockQuantity is long requestedStock && (requestedStock < 0 || requestedStock > item.Quantity))
            return Fail("تعداد خرید، تعداد ورود به انبار یا فی خرید نامعتبر است.");
        if ((item.ProductId is null) == (item.NewProduct is null)) return Fail("برای هر ردیف، کالای موجود یا مشخصات کالای جدید را انتخاب کنید.");
        Product? product;
        if (item.NewProduct is NewPurchaseProduct next)
        {
            var sku = next.Sku?.Trim() ?? "";
            if (string.IsNullOrWhiteSpace(next.Name) || next.Name.Length > 300 || sku.Length is < 1 or > 100 ||
                next.PriceRial < 0 || next.Category?.Length > 200 || !newSkus.Add(sku) ||
                await db.Products.AnyAsync(x => x.TenantId == tid && x.Sku == sku))
                return Fail("نام، شناسه، دسته یا قیمت کالای جدید نامعتبر یا تکراری است.", 409);
            product = new Product { TenantId = tid, Name = next.Name.Trim(), Sku = sku,
                Category = next.Category?.Trim() ?? "", PriceRial = next.PriceRial, Stock = 0 };
            db.Products.Add(product);
            Audit(db, c.User, tid, "product.create-from-purchase", "product", product.Id);
        }
        else product = await db.Products.SingleOrDefaultAsync(x => x.Id == item.ProductId && x.TenantId == tid && !x.Archived);
        if (product is null) return Fail("کالای خرید یافت نشد.");
        var lineTotal = checked(item.Quantity * item.UnitCostRial); purchase.TotalRial = checked(purchase.TotalRial + lineTotal);
        purchase.Lines.Add(new PurchaseLine { ProductId = product.Id, NameSnapshot = product.Name, Quantity = item.Quantity, UnitCostRial = item.UnitCostRial, TotalRial = lineTotal });
        var stockQuantity = item.StockQuantity ?? item.Quantity;
        if (stockQuantity > 0 && product.Stock == 0) { product.AverageCostRial = item.UnitCostRial; product.CostKnown = true; }
        else if (stockQuantity > 0 && product.CostKnown)
        {
            var value = (BigInteger)product.Stock * product.AverageCostRial + (BigInteger)stockQuantity * item.UnitCostRial;
            var quantity = (BigInteger)product.Stock + stockQuantity;
            product.AverageCostRial = checked((long)((value + quantity / 2) / quantity));
        }
        product.Stock = checked(product.Stock + stockQuantity); product.UpdatedAt = DateTime.UtcNow;
        if (stockQuantity > 0) db.StockMovements.Add(new StockMovement { TenantId = tid, ProductId = product.Id, Delta = stockQuantity, Reason = "purchase-received" });
    }
    if (body.PaidRial < 0 || body.PaidRial > purchase.TotalRial) return Fail("پرداخت خرید از جمع بیشتر است.");
    purchase.PaidRial = body.PaidRial;
    if (body.PaidRial > 0) db.PurchasePayments.Add(new PurchasePayment { TenantId = tid, PurchaseId = purchase.Id, AmountRial = body.PaidRial, Method = "initial" });
    if (body.PaidRial < purchase.TotalRial && body.DueAt is DateTime due) db.Reminders.Add(new Reminder { TenantId = tid, Title = $"پرداخت مانده خرید از {purchase.SupplierName}", DueAt = due.ToUniversalTime() });
    db.Purchases.Add(purchase); Audit(db, c.User, tid, "purchase.receive", "purchase", purchase.Id);
    try { await db.SaveChangesAsync(); await tx.CommitAsync(); } catch (DbUpdateException) { return Fail("خرید هم‌زمان ثبت شد؛ داده‌ها را دوباره بررسی کنید.", 409); }
    return Results.Created($"/api/merchant/accounting/purchases/{purchase.Id}", new { purchase.Id, purchase.TotalRial, purchase.PaidRial });
});
merchant.MapPost("/accounting/purchases/{id:guid}/payments", async (Guid id, PaymentRequest body, MajoraDb db, HttpContext c) =>
{
    if (!CanWrite(c.User)) return Results.Forbid(); var tid = TenantId(c.User);
    await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
    var purchase = await db.Purchases.SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tid); if (purchase is null) return Results.NotFound();
    if (body.AmountRial < 1 || body.AmountRial > purchase.TotalRial - purchase.PaidRial) return Fail("مبلغ پرداخت خرید نامعتبر است.");
    purchase.PaidRial = checked(purchase.PaidRial + body.AmountRial); db.PurchasePayments.Add(new PurchasePayment { TenantId = tid, PurchaseId = id, AmountRial = body.AmountRial, Method = body.Method.Trim() });
    Audit(db, c.User, tid, "purchase.payment", "purchase", id, $"amount={body.AmountRial}"); await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok(new { purchase.PaidRial });
});
merchant.MapGet("/accounting/expenses", async (MajoraDb db, HttpContext c) => { var tid = TenantId(c.User); return Results.Ok(await db.Expenses.Where(x => x.TenantId == tid && !x.Voided).OrderByDescending(x => x.IncurredAt).Take(100).ToListAsync()); });
merchant.MapPost("/accounting/expenses", async (ExpenseRequest body, MajoraDb db, HttpContext c) =>
{
    if (!CanWrite(c.User)) return Results.Forbid();
    if (string.IsNullOrWhiteSpace(body.Category) || body.Category.Length > 200 || body.AmountRial < 1 ||
        body.IncurredAt is DateTime date && (date.Year < 2000 || date > DateTime.UtcNow.AddDays(1)))
        return Fail("دسته، مبلغ یا تاریخ هزینه معتبر نیست.");
    var e = new Expense { TenantId = TenantId(c.User), Category = body.Category.Trim(), Description = body.Description?.Trim() ?? "", AmountRial = body.AmountRial,
        IncurredAt = body.IncurredAt?.ToUniversalTime() ?? DateTime.UtcNow };
    db.Expenses.Add(e); Audit(db, c.User, e.TenantId, "expense.create", "expense", e.Id); await db.SaveChangesAsync(); return Results.Created($"/api/merchant/accounting/expenses/{e.Id}", e);
});
merchant.MapPut("/accounting/expenses/{id:guid}", async (Guid id, ExpenseRequest body, MajoraDb db, HttpContext c) =>
{
    if (!CanWrite(c.User)) return Results.Forbid();
    if (string.IsNullOrWhiteSpace(body.Category) || body.Category.Length > 200 || body.AmountRial < 1 ||
        string.IsNullOrWhiteSpace(body.Reason) || body.Reason.Length > 500 ||
        body.IncurredAt is DateTime date && (date.Year < 2000 || date > DateTime.UtcNow.AddDays(1)))
        return Fail("دسته، مبلغ، تاریخ و دلیل اصلاح هزینه لازم است.");
    var tid = TenantId(c.User);
    var expense = await db.Expenses.SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tid && !x.Voided);
    if (expense is null) return Results.NotFound();
    var old = new { expense.Category, expense.Description, expense.AmountRial, expense.IncurredAt };
    expense.Category = body.Category.Trim(); expense.Description = body.Description?.Trim() ?? "";
    expense.AmountRial = body.AmountRial; expense.IncurredAt = body.IncurredAt?.ToUniversalTime() ?? expense.IncurredAt;
    Audit(db, c.User, tid, "expense.update", "expense", id,
        JsonSerializer.Serialize(new { old, current = new { expense.Category, expense.Description, expense.AmountRial, expense.IncurredAt }, reason = body.Reason.Trim() }));
    await db.SaveChangesAsync(); return Results.Ok(expense);
});
merchant.MapPost("/accounting/expenses/{id:guid}/void", async (Guid id, MajoraDb db, HttpContext c) =>
{
    if (Role(c.User) != "owner") return Results.Forbid(); var tid = TenantId(c.User); var e = await db.Expenses.SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tid && !x.Voided); if (e is null) return Results.NotFound();
    e.Voided = true; Audit(db, c.User, tid, "expense.void", "expense", id); await db.SaveChangesAsync(); return Results.NoContent();
});
merchant.MapGet("/advisor", async (MajoraDb db, HttpContext c) =>
{
    var tid = TenantId(c.User); var date = DateTime.UtcNow.AddDays(-30);
    var sales = await FinanceMath.LoadSalesMetricsAsync(db, tid, date);
    var purchases = await db.Purchases.Where(x => x.TenantId == tid && x.PurchasedAt >= date).ToListAsync();
    var expenses = await db.Expenses.Where(x => x.TenantId == tid && !x.Voided && x.IncurredAt >= date).ToListAsync();
    var lowStock = await db.Products.Where(x => x.TenantId == tid && !x.Archived && x.Stock <= 3).OrderBy(x => x.Stock).Take(5).Select(x => new { x.Name, x.Stock }).ToListAsync();
    return Results.Ok(new { periodDays = 30, invoices = sales.InvoiceCount, salesRial = sales.NetSalesRial, outstandingRial = sales.ReceivableRial, purchasesRial = purchases.Sum(x => x.TotalRial), supplierPayableRial = purchases.Sum(x => x.TotalRial - x.PaidRial), expensesRial = expenses.Sum(x => x.AmountRial), lowStock, suggestions = new[] { sales.ReceivableRial > 0 ? "ماندهٔ فاکتورها را بر اساس تاریخ سررسید پیگیری کنید." : "ماندهٔ باز ثبت‌شده‌ای دیده نمی‌شود.", lowStock.Count > 0 ? "برای کالاهای کم‌موجودی نقطهٔ سفارش تعریف کنید." : "موجودی بحرانی ثبت‌شده‌ای دیده نمی‌شود.", purchases.Sum(x=>x.TotalRial-x.PaidRial)>0 ? "بدهی تأمین‌کنندگان را با وصول مطالبات هماهنگ کنید." : "بدهی خرید ثبت‌شده‌ای در ۳۰ روز اخیر دیده نمی‌شود." }, note = "این تحلیل فقط از داده‌های ثبت‌شده استفاده می‌کند و جای رسیدگی حسابداری تخصصی را نمی‌گیرد." });
});
merchant.MapPost("/advisor/ask", async (AdvisorQuestion body, MajoraDb db, HttpContext c, IHttpClientFactory clients, IConfiguration config, IDataProtectionProvider protection) =>
{
    if (string.IsNullOrWhiteSpace(body.Question) || body.Question.Length > 1000) return Fail("پرسش باید بین ۱ تا ۱۰۰۰ نویسه باشد.");
    var tid = TenantId(c.User); var since = DateTime.UtcNow.AddDays(-30);
    var sales = await FinanceMath.LoadSalesMetricsAsync(db, tid, since);
    var purchases = await db.Purchases.Where(x => x.TenantId == tid && x.PurchasedAt >= since).Select(x => new { x.TotalRial, x.PaidRial }).ToListAsync();
    var expenses = await db.Expenses.Where(x => x.TenantId == tid && !x.Voided && x.IncurredAt >= since).Select(x => x.AmountRial).ToListAsync();
    var lowStock = await db.Products.Where(x => x.TenantId == tid && !x.Archived && x.Stock <= 3).CountAsync();
    var facts = new { periodDays = 30, invoiceCount = sales.InvoiceCount, salesRial = sales.NetSalesRial, outstandingRial = sales.ReceivableRial, refundDueRial = sales.RefundDueRial, purchasesRial = purchases.Sum(x => x.TotalRial), supplierPayableRial = purchases.Sum(x => x.TotalRial - x.PaidRial), expensesRial = expenses.Sum(), lowStockCount = lowStock };
    var profile = await db.AiProviderProfiles.AsNoTracking().SingleOrDefaultAsync(x => x.Id == 1);
    var endpoint = profile is null ? config["MAJORA_AI_ENDPOINT"] : profile.Enabled ? profile.Endpoint : null;
    var model = profile is null ? config["MAJORA_AI_MODEL"] : profile.Enabled ? profile.Model : null;
    string? key;
    try { key = profile is null ? config["MAJORA_AI_API_KEY"] : profile.Enabled ? protection.CreateProtector("ai-provider-key-v1").Unprotect(profile.ProtectedApiKey) : null; }
    catch (System.Security.Cryptography.CryptographicException) { return Fail("کلید سرویس هوش مصنوعی قابل بازیابی نیست؛ تنظیمات را دوباره ثبت کنید.", 503); }
    if (string.IsNullOrWhiteSpace(endpoint) || string.IsNullOrWhiteSpace(key) || string.IsNullOrWhiteSpace(model))
        return Results.Ok(new { answer = $"در ۳۰ روز اخیر {facts.invoiceCount} فاکتور و {facts.salesRial:N0} ریال فروش ثبت شده است. ماندهٔ باز {facts.outstandingRial:N0} ریال است و {facts.lowStockCount} کالا موجودی پایین دارند. برای پاسخ تحلیلی آزاد، مدیر ماژورا باید ارائه‌دهندهٔ هوش مصنوعی را روی سرور تنظیم کند.", facts, source = "rules" });
    IResult RuleFallback(AiFailure failure) => Results.Ok(new {
        answer = $"در ۳۰ روز اخیر {facts.invoiceCount} فاکتور و {facts.salesRial:N0} ریال فروش ثبت شده است. ماندهٔ باز {facts.outstandingRial:N0} ریال است و {facts.lowStockCount} کالا موجودی پایین دارند. تحلیل هوش مصنوعی اکنون در دسترس نیست؛ این ارقام از داده‌های ثبت‌شده محاسبه شده‌اند.",
        facts, source = "rules", warning = failure.Message, errorCode = failure.Code, correlationId = c.TraceIdentifier
    });
    if (!AiEndpointGuard.ValidUri(endpoint, out var uri)) return RuleFallback(new("invalid_endpoint", "نشانی HTTPS سرویس هوش مصنوعی نامعتبر است.", false));
    if (AiProviders.ValidateEndpoint(uri!, model) is { } endpointError) return RuleFallback(new("model_endpoint_mismatch", endpointError, false));
    using var client = clients.CreateClient("ai");
    using var request = AiProviders.CreateRequest(uri!, key, model,
        "تو مشاور فارسی کسب‌وکار MAJORA هستی. فقط از آمار خلاصهٔ ارائه‌شده استفاده کن. دادهٔ ناموجود را حدس نزن. دستور مالی قطعی یا اقدام خودکار نده. ۲ تا ۴ پیشنهاد عملی و دلیل هرکدام را کوتاه بگو. داده‌ها ممکن است ناقص باشند.",
        $"آمار ۳۰ روز: {JsonSerializer.Serialize(facts)}\nپرسش کاربر: {body.Question}", 700);
    try
    {
        using var response = await client.SendAsync(request, c.RequestAborted);
        if (!response.IsSuccessStatusCode) return RuleFallback(AiProviders.FromStatus(response.StatusCode));
        using var doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(c.RequestAborted), cancellationToken: c.RequestAborted);
        var answer = AiProviders.ReadAnswer(doc.RootElement, uri!);
        return Results.Ok(new { answer, facts, source = AiProviders.Kind(uri!) });
    }
    catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or KeyNotFoundException or JsonException or ArgumentOutOfRangeException) { return RuleFallback(AiProviders.FromException(ex)); }
}).RequireRateLimiting("login");
app.MapFallbackToFile("index.html");
app.Run();

public sealed record LoginRequest(string Username, string Password);
public sealed record PlanRequest(string Name, long MonthlyRial, int MaxUsers, bool Enabled = true, string? Description = null, List<string>? Features = null);
public sealed record PromoCodeRequest(string Code, decimal Percent, DateTime StartsAt, DateTime ExpiresAt, bool Enabled = true);
public sealed record BillingRequest(string CardNumber, string CardHolder);
public sealed record SubscriptionOrderRequest(Guid PlanId, string IdempotencyKey, string? PromoCode, string? ReceiptDataUrl, long ExpectedTotalRial);
public sealed record SubscriptionDecision(string Decision);
public sealed record UsernameUpdate(string Username);
public sealed record TenantRequest(string Name, string Slug, string OwnerUsername, string OwnerName, string OwnerPassword, string? BrandColor, bool ClassicPreset = false);
public sealed record TenantUpdate(string Name, bool Enabled, string? BrandColor, string? LogoUrl);
public sealed record AdminInvoiceBrandUpdate(InvoiceBrandUpdate Brand, string Reason);
public sealed record SubscriptionRequest(Guid PlanId, DateTime StartsAt, DateTime EndsAt, string PaymentStatus, long? PriceRial, string? Note);
public sealed record ProductRequest(string Name, string Sku, string Category, long PriceRial, long Stock, long? AverageCostRial = null, string? PhotoDataUrl = null);
public sealed record ProductPriceUpdate(long ExpectedPriceRial, long NewPriceRial);
public sealed record GlobalSearchHit(string Kind, Guid Id, string Title, string Subtitle);
public sealed record ProductPhotoRequest(string DataUrl);
public sealed record PriceBatchRequest(string IdempotencyKey, decimal Percent, bool AllProducts, List<Guid>? ProductIds);
public sealed record CustomerRequest(string Name, string Phone, string? Address = null, string? Occupation = null,
    string? AcquisitionSource = null, string? ReferrerPhone = null, string? Notes = null);
public sealed record InvoiceRequest(string IdempotencyKey, Guid? CustomerId, string CustomerName, string CustomerPhone, string PaymentStatus, long PaidRial, DateTime? DueAt, List<InvoiceLineRequest> Lines, long? ExpectedTotalRial = null, ChequeRequest? Cheque = null);
public sealed record ChequeRequest(string Direction, string Party, string Serial, string Bank, long AmountRial, DateTime DueAt, string? SayadId, string? IssuerNationalId, string? BeneficiaryNationalId, string RegistrationStatus, string? Note, bool ShowDetails = false, bool ShowImage = false, string? PhotoDataUrl = null);
public sealed record ChequeStatusRequest(string Status, string? Reason = null);
public sealed record InvoiceLineRequest(Guid? ProductId, long Quantity, long? ExpectedUnitPriceRial = null, decimal DiscountPercent = 0, string? Name = null, long? UnitPriceRial = null);
public sealed record InvoiceRevisionRequest(int ExpectedRevision, string Reason, string CustomerName, string CustomerPhone, DateTime? IssuedAt, List<InvoiceLineRevisionRequest> Lines);
public sealed record InvoiceLineRevisionRequest(Guid? LineId, Guid? ProductId, string Name, long UnitPriceRial, long Quantity, long DiscountRial);
public sealed record PaymentRequest(string IdempotencyKey, long AmountRial, string Method, string? Reference);
public sealed record SalesReturnRequest(string IdempotencyKey, string Reason, List<SalesReturnLineRequest> Lines);
public sealed record SalesReturnLineRequest(Guid InvoiceLineId, long Quantity, bool Restock);
public sealed record RefundRequest(string IdempotencyKey, long AmountRial, string Method, string? Reference);
public sealed record ReminderRequest(string Title, DateTime DueAt);
public sealed record StaffRequest(string Username, string DisplayName, string Password, string Role);
public sealed record EnabledRequest(bool Enabled);
public sealed record AdvisorQuestion(string Question);
public sealed record AiProviderRequest(bool Enabled, string Endpoint, string Model, string? ApiKey);
public sealed record PasswordChange(string CurrentPassword, string NewPassword);
public sealed record PasswordReset(string NewPassword);
public sealed record PurchaseRequest(string IdempotencyKey, string SupplierName, string? SupplierInvoiceNumber, long PaidRial, DateTime? DueAt, List<PurchaseLineRequest> Lines, DateTime? PurchasedAt = null);
public sealed record PurchaseLineRequest(Guid? ProductId, long Quantity, long UnitCostRial, NewPurchaseProduct? NewProduct = null, long? StockQuantity = null);
public sealed record NewPurchaseProduct(string Name, string Sku, string? Category, long PriceRial);
public sealed record ExpenseRequest(string Category, string? Description, long AmountRial, DateTime? IncurredAt = null, string? Reason = null);
