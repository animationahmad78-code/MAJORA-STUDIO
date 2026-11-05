using System.Data;
using System.Net;
using System.Security.Claims;
using System.Text.Json;
using System.Net.Http.Json;
using System.Numerics;
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
});
builder.Services.AddAuthorization();
builder.Services.AddRateLimiter(o => o.AddPolicy("login", context => RateLimitPartition.GetFixedWindowLimiter(
    context.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions
    { PermitLimit = 10, Window = TimeSpan.FromMinutes(5), QueueLimit = 0 })));
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
app.UseDefaultFiles(); app.UseStaticFiles(); app.UseRateLimiter(); app.UseAuthentication(); app.UseAuthorization();

app.Use(async (ctx, next) =>
{
    if (ctx.User.Identity?.IsAuthenticated == true && ctx.Request.Path.StartsWithSegments("/api"))
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
            var cookie = ctx.Request.Cookies["majora.csrf"];
            if (string.IsNullOrEmpty(cookie) || cookie != ctx.Request.Headers["X-CSRF"].ToString())
            { ctx.Response.StatusCode = 400; await ctx.Response.WriteAsJsonAsync(new { error = "توکن امنیتی درخواست نامعتبر است." }); return; }
        }
    }
    await next();
});

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<MajoraDb>();
    if (app.Environment.IsDevelopment() && provider.Equals("Sqlite", StringComparison.OrdinalIgnoreCase)) await db.Database.EnsureCreatedAsync();
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
static IResult Fail(string message, int status = 400) => Results.Json(new { error = message }, statusCode: status);
static void Audit(MajoraDb db, ClaimsPrincipal p, Guid? tenantId, string action, string entity, Guid id, string detail = "") => db.Audit.Add(new AuditEntry { ActorId = UserId(p), TenantId = tenantId, Action = action, EntityType = entity, EntityId = id.ToString(), Detail = detail });
static async Task<bool> Active(MajoraDb db, Guid tenantId) => await db.Tenants.AnyAsync(t => t.Id == tenantId && t.Enabled) && await db.Subscriptions.AnyAsync(s => s.TenantId == tenantId && s.PaymentStatus == "paid" && s.StartsAt <= DateTime.UtcNow && s.EndsAt > DateTime.UtcNow);
static void Csrf(HttpContext c) { var token = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(24)); c.Response.Cookies.Append("majora.csrf", token, new CookieOptions { HttpOnly = false, Secure = !c.RequestServices.GetRequiredService<IHostEnvironment>().IsDevelopment() || c.Request.IsHttps, SameSite = SameSiteMode.Strict, Path = "/" }); }

app.MapGet("/api/health", () => Results.Ok(new { status = "ok", version = "web-foundation-1" }));
app.MapPost("/api/auth/login", async (LoginRequest body, MajoraDb db, IPasswordHasher<AppUser> hasher, HttpContext ctx) =>
{
    var user = await db.Users.SingleOrDefaultAsync(x => x.Username == body.Username && x.Enabled);
    if (user is null || hasher.VerifyHashedPassword(user, user.PasswordHash, body.Password) == PasswordVerificationResult.Failed) return Fail("نام کاربری یا رمز عبور نادرست است.", 401);
    if (user.TenantId is Guid tid && !await Active(db, tid)) return Fail("اشتراک این کسب‌وکار فعال نیست. با پشتیبانی ماژورا تماس بگیرید.", 403);
    var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, user.Id.ToString()), new(ClaimTypes.Name, user.DisplayName), new(ClaimTypes.Role, user.Role), new("authVersion", user.AuthVersion.ToString()) };
    if (user.TenantId is Guid tenantId) claims.Add(new Claim("tenant", tenantId.ToString()));
    await ctx.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme)));
    Csrf(ctx);
    return Results.Ok(new { user.Id, user.DisplayName, user.Role, user.TenantId });
}).RequireRateLimiting("login");
app.MapPost("/api/auth/logout", async (HttpContext ctx) => { await ctx.SignOutAsync(); ctx.Response.Cookies.Delete("majora.csrf"); return Results.NoContent(); }).RequireAuthorization();
app.MapGet("/api/auth/me", async (MajoraDb db, HttpContext c) =>
{
    var user = await db.Users.FindAsync(UserId(c.User));
    if (user is null || !user.Enabled) return Results.Unauthorized();
    Csrf(c);
    return Results.Ok(new { user.Id, user.DisplayName, user.Role, user.TenantId });
}).RequireAuthorization();
app.MapPost("/api/auth/change-password", async (PasswordChange body, MajoraDb db, IPasswordHasher<AppUser> hasher, HttpContext c) =>
{
    var user = await db.Users.FindAsync(UserId(c.User)); if (user is null) return Results.Unauthorized();
    if (body.NewPassword.Length < 12 || hasher.VerifyHashedPassword(user, user.PasswordHash, body.CurrentPassword) == PasswordVerificationResult.Failed) return Fail("رمز فعلی نادرست است یا رمز جدید کمتر از ۱۲ نویسه دارد.");
    user.PasswordHash = hasher.HashPassword(user, body.NewPassword); user.AuthVersion++;
    Audit(db, c.User, user.TenantId, "password.change", "user", user.Id); await db.SaveChangesAsync(); await c.SignOutAsync(); return Results.NoContent();
}).RequireAuthorization();

var admin = app.MapGroup("/api/admin").RequireAuthorization(p => p.RequireRole("platform_admin"));
admin.MapGet("/overview", async (MajoraDb db) => Results.Ok(new { tenants = await db.Tenants.CountAsync(), activeSubscriptions = await db.Subscriptions.CountAsync(s => s.PaymentStatus == "paid" && s.EndsAt > DateTime.UtcNow), users = await db.Users.CountAsync() }));
admin.MapGet("/ai-provider", async (MajoraDb db, IConfiguration config) =>
{
    var profile = await db.AiProviderProfiles.AsNoTracking().SingleOrDefaultAsync(x => x.Id == 1);
    return Results.Ok(profile is null
        ? new { enabled = !string.IsNullOrWhiteSpace(config["MAJORA_AI_API_KEY"]), endpoint = config["MAJORA_AI_ENDPOINT"] ?? "", model = config["MAJORA_AI_MODEL"] ?? "", hasApiKey = !string.IsNullOrWhiteSpace(config["MAJORA_AI_API_KEY"]), source = "server" }
        : new { enabled = profile.Enabled, endpoint = profile.Endpoint, model = profile.Model, hasApiKey = !string.IsNullOrWhiteSpace(profile.ProtectedApiKey), source = "panel" });
});
admin.MapPut("/ai-provider", async (AiProviderRequest body, MajoraDb db, IDataProtectionProvider protection, HttpContext c) =>
{
    if (!AiEndpointGuard.ValidUri(body.Endpoint, out _) || string.IsNullOrWhiteSpace(body.Model) || body.Model.Length > 120 || body.ApiKey?.Length > 1000)
        return Fail("نشانی HTTPS یا نام مدل نامعتبر است.");
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
admin.MapGet("/plans", async (MajoraDb db) => Results.Ok(await db.Plans.OrderBy(x => x.MonthlyRial).ToListAsync()));
admin.MapPost("/plans", async (PlanRequest body, MajoraDb db, HttpContext c) =>
{
    if (string.IsNullOrWhiteSpace(body.Name) || body.MonthlyRial < 0 || body.MaxUsers < 1) return Fail("مشخصات طرح نامعتبر است.");
    var plan = new Plan { Name = body.Name.Trim(), MonthlyRial = body.MonthlyRial, MaxUsers = body.MaxUsers };
    db.Plans.Add(plan); Audit(db, c.User, null, "plan.create", "plan", plan.Id); await db.SaveChangesAsync(); return Results.Created($"/api/admin/plans/{plan.Id}", plan);
});
admin.MapPut("/plans/{id:guid}", async (Guid id, PlanRequest body, MajoraDb db, HttpContext c) =>
{
    var plan = await db.Plans.FindAsync(id); if (plan is null) return Results.NotFound();
    if (string.IsNullOrWhiteSpace(body.Name) || body.MonthlyRial < 0 || body.MaxUsers < 1) return Fail("مشخصات طرح نامعتبر است.");
    plan.Name = body.Name.Trim(); plan.MonthlyRial = body.MonthlyRial; plan.MaxUsers = body.MaxUsers; plan.Enabled = body.Enabled;
    Audit(db, c.User, null, "plan.update", "plan", id); await db.SaveChangesAsync(); return Results.Ok(plan);
});
admin.MapGet("/tenants", async (MajoraDb db) => Results.Ok(await db.Tenants.OrderBy(x => x.Name).Select(x => new { x.Id, x.Name, x.Slug, x.Enabled, x.BrandColor, x.LogoUrl, Subscription = db.Subscriptions.Where(s => s.TenantId == x.Id).OrderByDescending(s => s.EndsAt).Select(s => new { s.EndsAt, s.PaymentStatus, s.PriceRialSnapshot }).FirstOrDefault() }).ToListAsync()));
admin.MapPost("/tenants", async (TenantRequest body, MajoraDb db, IPasswordHasher<AppUser> hasher, IWebHostEnvironment host, HttpContext c) =>
{
    if (string.IsNullOrWhiteSpace(body.Name) || string.IsNullOrWhiteSpace(body.Slug) || !System.Text.RegularExpressions.Regex.IsMatch(body.Slug, "^[a-z0-9-]{3,40}$") || body.OwnerPassword.Length < 12 || string.IsNullOrWhiteSpace(body.OwnerUsername)) return Fail("نام، شناسه یا رمز مالک نامعتبر است؛ رمز حداقل ۱۲ نویسه باشد.");
    if (await db.Tenants.AnyAsync(x => x.Slug == body.Slug) || await db.Users.AnyAsync(x => x.Username == body.OwnerUsername)) return Fail("شناسهٔ فروشگاه یا نام کاربری تکراری است.", 409);
    var tenant = new Tenant { Name = body.Name.Trim(), Slug = body.Slug, BrandColor = body.BrandColor ?? "#0B2B53" };
    var owner = new AppUser { TenantId = tenant.Id, Username = body.OwnerUsername.Trim(), DisplayName = body.OwnerName.Trim(), Role = "owner" };
    owner.PasswordHash = hasher.HashPassword(owner, body.OwnerPassword);
    db.Tenants.Add(tenant); db.Users.Add(owner);
    db.InvoiceBrands.Add(InvoiceBrand.Create(tenant.Id, tenant.Name, body.ClassicPreset, host.WebRootPath));
    Audit(db, c.User, tenant.Id, "tenant.create", "tenant", tenant.Id); await db.SaveChangesAsync(); return Results.Created($"/api/admin/tenants/{tenant.Id}", new { tenant.Id, tenant.Name, tenant.Slug });
});
admin.MapPut("/tenants/{id:guid}", async (Guid id, TenantUpdate body, MajoraDb db, HttpContext c) =>
{
    var tenant = await db.Tenants.FindAsync(id); if (tenant is null) return Results.NotFound();
    if (string.IsNullOrWhiteSpace(body.Name)) return Fail("نام فروشگاه لازم است.");
    tenant.Name = body.Name.Trim(); tenant.Enabled = body.Enabled; tenant.BrandColor = body.BrandColor ?? tenant.BrandColor; tenant.LogoUrl = body.LogoUrl;
    Audit(db, c.User, id, "tenant.update", "tenant", id, $"enabled={body.Enabled}"); await db.SaveChangesAsync(); return Results.Ok(tenant);
});
admin.MapPost("/tenants/{id:guid}/subscription", async (Guid id, SubscriptionRequest body, MajoraDb db, HttpContext c) =>
{
    if (!await db.Tenants.AnyAsync(x => x.Id == id)) return Results.NotFound();
    var plan = await db.Plans.FindAsync(body.PlanId); if (plan is null || !plan.Enabled || body.EndsAt <= body.StartsAt || body.PriceRial < 0) return Fail("طرح یا بازهٔ اشتراک نامعتبر است.");
    var sub = new Subscription { TenantId = id, PlanId = plan.Id, StartsAt = body.StartsAt, EndsAt = body.EndsAt, PriceRialSnapshot = body.PriceRial ?? plan.MonthlyRial, PaymentStatus = body.PaymentStatus == "paid" ? "paid" : "pending", Note = body.Note ?? "" };
    db.Subscriptions.Add(sub); Audit(db, c.User, id, "subscription.create", "subscription", sub.Id); await db.SaveChangesAsync(); return Results.Created($"/api/admin/tenants/{id}/subscription", sub);
});
admin.MapGet("/tenants/{id:guid}/users", async (Guid id, MajoraDb db) => Results.Ok(await db.Users.Where(x => x.TenantId == id).Select(x => new { x.Id, x.Username, x.DisplayName, x.Role, x.Enabled }).ToListAsync()));
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
    if (!await Active(db, TenantId(c.User)) && !c.Request.Path.Value!.EndsWith("/subscription", StringComparison.Ordinal)) return Fail("اشتراک فعال نیست.", 403);
    return await next(invocation);
});
merchant.MapGet("/subscription", async (MajoraDb db, HttpContext c) =>
{
    var tid = TenantId(c.User);
    return Results.Ok(await db.Subscriptions.Where(s => s.TenantId == tid).Join(db.Plans, s => s.PlanId, p => p.Id, (s,p) => new { s.Id, Plan = p.Name, s.StartsAt, s.EndsAt, s.PaymentStatus, s.PriceRialSnapshot, p.MaxUsers }).OrderByDescending(s => s.EndsAt).ToListAsync());
});
merchant.MapGet("/workspace", async (MajoraDb db, HttpContext c) => { var tid = TenantId(c.User); var tenant = await db.Tenants.SingleAsync(t => t.Id == tid); var profile = await db.InvoiceBrands.AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tid); return Results.Ok(new { tenant.Name, tenant.Slug, LogoUrl = profile?.LogoDataUrl ?? tenant.LogoUrl, tenant.BrandColor }); });
merchant.MapGet("/invoice-brand", async (MajoraDb db, HttpContext c) =>
{
    var tid = TenantId(c.User);
    var profile = await db.InvoiceBrands.AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tid);
    if (profile is null) profile = InvoiceBrand.Create(tid, (await db.Tenants.SingleAsync(x => x.Id == tid)).Name, false, null);
    return Results.Ok(InvoiceBrand.View(profile));
});
merchant.MapPut("/invoice-brand", async (InvoiceBrandUpdate body, MajoraDb db, HttpContext c) =>
{
    if (!CanWrite(c.User)) return Results.Forbid();
    var invalid = InvoiceBrand.Validate(body); if (invalid is not null) return Fail(invalid);
    var tid = TenantId(c.User);
    var profile = await db.InvoiceBrands.SingleOrDefaultAsync(x => x.TenantId == tid);
    if (profile is null)
    {
        profile = InvoiceBrand.Create(tid, (await db.Tenants.SingleAsync(x => x.Id == tid)).Name, false, null);
        db.InvoiceBrands.Add(profile);
    }
    if (profile.Revision != body.Revision) return Fail("قالب در دستگاه دیگری تغییر کرده است؛ صفحه را تازه کنید.", 409);
    InvoiceBrand.Apply(profile, body);
    Audit(db, c.User, tid, "invoice-brand.update", "invoice-brand", tid, $"revision={profile.Revision}");
    try { await db.SaveChangesAsync(); }
    catch (DbUpdateConcurrencyException) { return Fail("قالب هم‌زمان تغییر کرده است؛ صفحه را تازه کنید.", 409); }
    catch (DbUpdateException) { return Fail("قالب هم‌زمان ثبت شده است؛ صفحه را تازه کنید.", 409); }
    return Results.Ok(InvoiceBrand.View(profile));
});
merchant.MapGet("/dashboard", async (MajoraDb db, HttpContext c) =>
{
    var tid = TenantId(c.User); var since = DateTime.UtcNow.AddDays(-30);
    var invoices = await db.Invoices.Where(x => x.TenantId == tid && x.Status == "issued" && x.PaymentStatus != "proforma" && x.IssuedAt >= since).ToListAsync();
    var returns30 = await db.SalesReturns.Where(x => x.TenantId == tid && x.CreatedAt >= since).SumAsync(x => x.AmountRial);
    var receipts30 = await db.Payments.Where(x => x.TenantId == tid && x.ReceivedAt >= since).SumAsync(x => x.AmountRial);
    var refunds30 = await db.Refunds.Where(x => x.TenantId == tid && x.RefundedAt >= since).SumAsync(x => x.AmountRial);
    var openInvoices = await db.Invoices.Where(x => x.TenantId == tid && x.Status == "issued" && x.PaymentStatus != "proforma").ToListAsync();
    return Results.Ok(new { sales30Rial = invoices.Sum(x => x.TotalRial) - returns30, received30Rial = receipts30 - refunds30, receivable30Rial = openInvoices.Sum(FinanceMath.Receivable), refundDueRial = openInvoices.Sum(FinanceMath.RefundDue), invoiceCount30 = invoices.Count, customers = await db.Customers.CountAsync(x => x.TenantId == tid && !x.Archived), products = await db.Products.CountAsync(x => x.TenantId == tid && !x.Archived), lowStock = await db.Products.CountAsync(x => x.TenantId == tid && !x.Archived && x.Stock <= 3), overdue = await db.Reminders.CountAsync(x => x.TenantId == tid && !x.Done && x.DueAt <= DateTime.UtcNow) });
});
merchant.MapGet("/products", async (string? q, int? page, MajoraDb db, HttpContext c) => { var tid = TenantId(c.User); return Results.Ok(await db.Products.Where(x => x.TenantId == tid && !x.Archived && (q == null || x.Name.Contains(q) || x.Sku.Contains(q))).OrderBy(x => x.Name).Skip(Math.Max(0, (page ?? 1) - 1) * 50).Take(50).ToListAsync()); });
merchant.MapPost("/products", async (ProductRequest body, MajoraDb db, HttpContext c) =>
{
    if (!CanWrite(c.User)) return Results.Forbid();
    if (string.IsNullOrWhiteSpace(body.Name) || string.IsNullOrWhiteSpace(body.Sku) || body.PriceRial < 0 || body.Stock < 0 || body.AverageCostRial < 0) return Fail("مشخصات کالا نامعتبر است.");
    var product = new Product { TenantId = TenantId(c.User), Name = body.Name.Trim(), Sku = body.Sku.Trim(), Category = body.Category.Trim(), PriceRial = body.PriceRial, Stock = body.Stock, AverageCostRial = body.AverageCostRial ?? 0, CostKnown = body.AverageCostRial is not null };
    db.Products.Add(product); Audit(db, c.User, product.TenantId, "product.create", "product", product.Id); await db.SaveChangesAsync(); return Results.Created($"/api/merchant/products/{product.Id}", product);
});
merchant.MapPut("/products/{id:guid}", async (Guid id, ProductRequest body, MajoraDb db, HttpContext c) =>
{
    if (!CanWrite(c.User)) return Results.Forbid();
    var tid = TenantId(c.User); var p = await db.Products.SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tid && !x.Archived); if (p is null) return Results.NotFound();
    if (string.IsNullOrWhiteSpace(body.Name) || body.PriceRial < 0 || body.Stock < 0 || body.AverageCostRial < 0) return Fail("مشخصات کالا نامعتبر است.");
    var delta = body.Stock - p.Stock; p.Name = body.Name.Trim(); p.Category = body.Category.Trim(); p.Sku = body.Sku.Trim(); p.PriceRial = body.PriceRial; p.Stock = body.Stock; p.UpdatedAt = DateTime.UtcNow;
    if (body.AverageCostRial is long cost) { p.AverageCostRial = cost; p.CostKnown = true; }
    if (delta != 0) db.StockMovements.Add(new StockMovement { TenantId = p.TenantId, ProductId = p.Id, Delta = delta, Reason = "manual-adjustment" });
    Audit(db, c.User, p.TenantId, "product.update", "product", p.Id); await db.SaveChangesAsync(); return Results.Ok(p);
});
merchant.MapGet("/customers", async (string? q, MajoraDb db, HttpContext c) => { var tid = TenantId(c.User); return Results.Ok(await db.Customers.Where(x => x.TenantId == tid && !x.Archived && (q == null || x.Name.Contains(q) || x.Phone.Contains(q))).OrderByDescending(x => x.CreatedAt).Take(100).ToListAsync()); });
merchant.MapPost("/customers", async (CustomerRequest body, MajoraDb db, HttpContext c) =>
{
    if (string.IsNullOrWhiteSpace(body.Name)) return Fail("نام مشتری لازم است.");
    var customer = new Customer { TenantId = TenantId(c.User), Name = body.Name.Trim(), Phone = body.Phone.Trim() }; db.Customers.Add(customer); Audit(db, c.User, customer.TenantId, "customer.create", "customer", customer.Id); await db.SaveChangesAsync(); return Results.Created($"/api/merchant/customers/{customer.Id}", customer);
});
merchant.MapGet("/invoices", async (string? q, MajoraDb db, HttpContext c) => { var tid = TenantId(c.User); return Results.Ok(await db.Invoices.Where(x => x.TenantId == tid && !x.Archived && (q == null || x.CustomerName.Contains(q) || x.CustomerPhone.Contains(q) || x.Number.ToString() == q)).OrderByDescending(x => x.IssuedAt).Take(100).Select(x => new { x.Id, x.Number, x.CustomerName, x.CustomerPhone, x.IssuedAt, x.TotalRial, x.PaidRial, x.ReturnedRial, x.RefundedRial, x.PaymentStatus, x.Status }).ToListAsync()); });
merchant.MapGet("/invoices/{id:guid}", async (Guid id, MajoraDb db, HttpContext c) => { var tid = TenantId(c.User); var invoice = await db.Invoices.Include(x => x.Lines).SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tid); return invoice is null ? Results.NotFound() : Results.Ok(invoice); });
merchant.MapPost("/invoices", async (InvoiceRequest body, MajoraDb db, HttpContext c) =>
{
    if (!CanSell(c.User)) return Results.Forbid();
    var tid = TenantId(c.User);
    if (string.IsNullOrWhiteSpace(body.IdempotencyKey) || body.IdempotencyKey.Length > 100 || body.Lines.Count is < 1 or > 200) return Fail("شناسهٔ درخواست یا اقلام نامعتبر است.");
    if (body.PaymentStatus is not ("paid" or "partial" or "unpaid" or "proforma")) return Fail("وضعیت پرداخت لازم است.");
    await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
    var existing = await db.Invoices.SingleOrDefaultAsync(x => x.TenantId == tid && x.IdempotencyKey == body.IdempotencyKey);
    if (existing is not null) return Results.Ok(new { existing.Id, existing.Number, existing.TotalRial });
    var tenant = await db.Tenants.SingleAsync(x => x.Id == tid); var customer = body.CustomerId is Guid cid ? await db.Customers.SingleOrDefaultAsync(x => x.Id == cid && x.TenantId == tid && !x.Archived) : null;
    if (body.CustomerId is not null && customer is null) return Fail("مشتری یافت نشد.");
    if (customer is null)
    {
        if (string.IsNullOrWhiteSpace(body.CustomerName) || body.CustomerName.Length > 200 || body.CustomerPhone.Length > 30) return Fail("نام یا شمارهٔ مشتری نامعتبر است.");
        customer = new Customer { TenantId = tid, Name = body.CustomerName.Trim(), Phone = body.CustomerPhone.Trim() };
        db.Customers.Add(customer);
    }
    var brandProfile = await db.InvoiceBrands.AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tid)
        ?? InvoiceBrand.Create(tid, tenant.Name, false, null);
    var invoice = new Invoice { TenantId = tid, Number = tenant.NextInvoiceNumber++, CustomerId = customer.Id, CustomerName = customer.Name, CustomerPhone = customer.Phone, PaymentStatus = body.PaymentStatus, IdempotencyKey = body.IdempotencyKey, BrandSnapshotJson = InvoiceBrand.Snapshot(brandProfile) };
    if (string.IsNullOrWhiteSpace(invoice.CustomerName)) return Fail("نام مشتری لازم است.");
    foreach (var item in body.Lines)
    {
        if (item.Quantity < 1 || item.Quantity > 1_000_000) return Fail("تعداد کالا نامعتبر است.");
        var p = await db.Products.SingleOrDefaultAsync(x => x.Id == item.ProductId && x.TenantId == tid && !x.Archived); if (p is null) return Fail("کالا یافت نشد.");
        if (body.PaymentStatus != "proforma" && p.Stock < item.Quantity) return Fail($"موجودی «{p.Name}» کافی نیست.", 409);
        var total = checked(p.PriceRial * item.Quantity); invoice.TotalRial = checked(invoice.TotalRial + total);
        invoice.Lines.Add(new InvoiceLine { ProductId = p.Id, NameSnapshot = p.Name, UnitPriceRial = p.PriceRial, Quantity = item.Quantity, TotalRial = total, UnitCostRialSnapshot = p.AverageCostRial, CostKnown = p.CostKnown });
        if (body.PaymentStatus != "proforma") { p.Stock -= item.Quantity; db.StockMovements.Add(new StockMovement { TenantId = tid, ProductId = p.Id, InvoiceId = invoice.Id, Delta = -item.Quantity, Reason = "invoice-issued" }); }
    }
    if (body.PaidRial < 0 || body.PaidRial > invoice.TotalRial || (body.PaymentStatus == "paid" && body.PaidRial != invoice.TotalRial) || (body.PaymentStatus == "partial" && (body.PaidRial <= 0 || body.PaidRial == invoice.TotalRial)) || (body.PaymentStatus is "unpaid" or "proforma" && body.PaidRial != 0)) return Fail("مبلغ پرداخت با وضعیت فاکتور سازگار نیست.");
    invoice.PaidRial = body.PaidRial; if (body.PaidRial > 0) db.Payments.Add(new Payment { TenantId = tid, InvoiceId = invoice.Id, AmountRial = body.PaidRial, Method = "initial" });
    if (body.PaymentStatus != "proforma" && invoice.PaidRial < invoice.TotalRial && body.DueAt is DateTime due) db.Reminders.Add(new Reminder { TenantId = tid, InvoiceId = invoice.Id, Title = $"پیگیری مانده فاکتور {invoice.Number}", DueAt = due });
    db.Invoices.Add(invoice); Audit(db, c.User, tid, "invoice.issue", "invoice", invoice.Id, $"number={invoice.Number}");
    try { await db.SaveChangesAsync(); await tx.CommitAsync(); }
    catch (DbUpdateException) { return Fail("هم‌زمانی در ثبت رخ داد؛ درخواست را دوباره بررسی کنید.", 409); }
    return Results.Created($"/api/merchant/invoices/{invoice.Id}", new { invoice.Id, invoice.Number, invoice.TotalRial, invoice.PaidRial });
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
    var invoice = await db.Invoices.Include(x => x.Lines).SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tid && x.Status == "issued" && x.PaymentStatus != "proforma");
    if (invoice is null) return Results.NotFound();
    var salesReturn = new SalesReturn { TenantId = tid, InvoiceId = id, IdempotencyKey = body.IdempotencyKey, Reason = body.Reason.Trim() };
    foreach (var item in body.Lines)
    {
        var line = invoice.Lines.SingleOrDefault(x => x.Id == item.InvoiceLineId);
        if (line is null || item.Quantity < 1 || item.Quantity > line.Quantity - line.ReturnedQuantity)
            return Fail("تعداد مرجوعی از مقدار باقی‌مانده بیشتر است یا ردیف معتبر نیست.");
        var amount = checked(line.UnitPriceRial * item.Quantity);
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
merchant.MapPost("/reminders/{id:guid}/done", async (Guid id, MajoraDb db, HttpContext c) => { var tid = TenantId(c.User); var r = await db.Reminders.SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tid); if (r is null) return Results.NotFound(); r.Done = true; Audit(db, c.User, r.TenantId, "reminder.done", "reminder", id); await db.SaveChangesAsync(); return Results.NoContent(); });
merchant.MapGet("/staff", async (MajoraDb db, HttpContext c) => { var tid = TenantId(c.User); return Results.Ok(await db.Users.Where(x => x.TenantId == tid).Select(x => new { x.Id, x.Username, x.DisplayName, x.Role, x.Enabled }).ToListAsync()); });
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
    var returnsRial = returns.Sum(x => x.AmountRial);
    var revenue = checked(sales.Sum(x => x.TotalRial) - returnsRial);
    var cogs = costComplete ? checked(sales.SelectMany(x => x.Lines).Sum(x => checked(x.UnitCostRialSnapshot * x.Quantity)) - returns.SelectMany(x => x.Lines).Sum(x => checked(x.UnitCostRialSnapshot * x.Quantity))) : (long?)null;
    var received = await db.Payments.Where(x => x.TenantId == tid && x.ReceivedAt >= since).SumAsync(x => x.AmountRial);
    var refunded = await db.Refunds.Where(x => x.TenantId == tid && x.RefundedAt >= since).SumAsync(x => x.AmountRial);
    return Results.Ok(new { periodDays = 30, revenueRial = revenue, returnsRial, receivedRial = received - refunded, refundedRial = refunded, customerReceivableRial = openInvoices.Sum(FinanceMath.Receivable), refundDueRial = openInvoices.Sum(FinanceMath.RefundDue), purchasesRial = purchases.Sum(x => x.TotalRial), supplierPayableRial = purchases.Sum(x => x.TotalRial - x.PaidRial), expensesRial = expenses.Sum(x => x.AmountRial), costComplete, costOfGoodsSoldRial = cogs, estimatedOperatingRial = cogs is null ? null : (long?)(revenue - cogs.Value - expenses.Sum(x => x.AmountRial)), note = "برآورد ۳۰روزهٔ عملیاتی است؛ مالیات، استهلاک و ماندهٔ ابتدای دوره در آن نیست. طلب و بازپرداخت، ماندهٔ باز همهٔ فاکتورهاست." });
});
merchant.MapGet("/accounting/purchases", async (MajoraDb db, HttpContext c) => { var tid = TenantId(c.User); return Results.Ok(await db.Purchases.Where(x => x.TenantId == tid).OrderByDescending(x => x.PurchasedAt).Take(100).Select(x => new { x.Id, x.SupplierName, x.SupplierInvoiceNumber, x.PurchasedAt, x.TotalRial, x.PaidRial }).ToListAsync()); });
merchant.MapPost("/accounting/purchases", async (PurchaseRequest body, MajoraDb db, HttpContext c) =>
{
    if (!CanWrite(c.User)) return Results.Forbid();
    if (string.IsNullOrWhiteSpace(body.SupplierName) || string.IsNullOrWhiteSpace(body.IdempotencyKey) || body.IdempotencyKey.Length > 100 || body.Lines is null || body.Lines.Count is < 1 or > 100) return Fail("اطلاعات خرید نامعتبر است.");
    var tid = TenantId(c.User); await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
    var existing = await db.Purchases.SingleOrDefaultAsync(x => x.TenantId == tid && x.IdempotencyKey == body.IdempotencyKey);
    if (existing is not null) return Results.Ok(new { existing.Id, existing.TotalRial });
    var purchase = new Purchase { TenantId = tid, SupplierName = body.SupplierName.Trim(), SupplierInvoiceNumber = body.SupplierInvoiceNumber?.Trim() ?? "", IdempotencyKey = body.IdempotencyKey };
    foreach (var item in body.Lines)
    {
        if (item.Quantity < 1 || item.Quantity > 1_000_000 || item.UnitCostRial < 0) return Fail("تعداد یا فی خرید نامعتبر است.");
        var product = await db.Products.SingleOrDefaultAsync(x => x.Id == item.ProductId && x.TenantId == tid && !x.Archived); if (product is null) return Fail("کالای خرید یافت نشد.");
        var lineTotal = checked(item.Quantity * item.UnitCostRial); purchase.TotalRial = checked(purchase.TotalRial + lineTotal);
        purchase.Lines.Add(new PurchaseLine { ProductId = product.Id, NameSnapshot = product.Name, Quantity = item.Quantity, UnitCostRial = item.UnitCostRial, TotalRial = lineTotal });
        if (product.Stock == 0) { product.AverageCostRial = item.UnitCostRial; product.CostKnown = true; }
        else if (product.CostKnown)
        {
            var value = (BigInteger)product.Stock * product.AverageCostRial + (BigInteger)item.Quantity * item.UnitCostRial;
            var quantity = (BigInteger)product.Stock + item.Quantity;
            product.AverageCostRial = checked((long)((value + quantity / 2) / quantity));
        }
        product.Stock = checked(product.Stock + item.Quantity); product.UpdatedAt = DateTime.UtcNow;
        db.StockMovements.Add(new StockMovement { TenantId = tid, ProductId = product.Id, Delta = item.Quantity, Reason = "purchase-received" });
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
    if (string.IsNullOrWhiteSpace(body.Category) || body.AmountRial < 1) return Fail("دسته و مبلغ هزینه لازم است.");
    var e = new Expense { TenantId = TenantId(c.User), Category = body.Category.Trim(), Description = body.Description?.Trim() ?? "", AmountRial = body.AmountRial };
    db.Expenses.Add(e); Audit(db, c.User, e.TenantId, "expense.create", "expense", e.Id); await db.SaveChangesAsync(); return Results.Created($"/api/merchant/accounting/expenses/{e.Id}", e);
});
merchant.MapPost("/accounting/expenses/{id:guid}/void", async (Guid id, MajoraDb db, HttpContext c) =>
{
    if (Role(c.User) != "owner") return Results.Forbid(); var tid = TenantId(c.User); var e = await db.Expenses.SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tid && !x.Voided); if (e is null) return Results.NotFound();
    e.Voided = true; Audit(db, c.User, tid, "expense.void", "expense", id); await db.SaveChangesAsync(); return Results.NoContent();
});
merchant.MapGet("/advisor", async (MajoraDb db, HttpContext c) =>
{
    var tid = TenantId(c.User); var date = DateTime.UtcNow.AddDays(-30);
    var invoices = await db.Invoices.Where(x => x.TenantId == tid && x.Status == "issued" && x.PaymentStatus != "proforma" && x.IssuedAt >= date).ToListAsync();
    var purchases = await db.Purchases.Where(x => x.TenantId == tid && x.PurchasedAt >= date).ToListAsync();
    var expenses = await db.Expenses.Where(x => x.TenantId == tid && !x.Voided && x.IncurredAt >= date).ToListAsync();
    var lowStock = await db.Products.Where(x => x.TenantId == tid && !x.Archived && x.Stock <= 3).OrderBy(x => x.Stock).Take(5).Select(x => new { x.Name, x.Stock }).ToListAsync();
    var outstanding = invoices.Sum(FinanceMath.Receivable);
    return Results.Ok(new { periodDays = 30, invoices = invoices.Count, salesRial = invoices.Sum(x => x.TotalRial - x.ReturnedRial), outstandingRial = outstanding, purchasesRial = purchases.Sum(x => x.TotalRial), supplierPayableRial = purchases.Sum(x => x.TotalRial - x.PaidRial), expensesRial = expenses.Sum(x => x.AmountRial), lowStock, suggestions = new[] { outstanding > 0 ? "ماندهٔ فاکتورها را بر اساس تاریخ سررسید پیگیری کنید." : "ماندهٔ باز ثبت‌شده‌ای در ۳۰ روز اخیر دیده نمی‌شود.", lowStock.Count > 0 ? "برای کالاهای کم‌موجودی نقطهٔ سفارش تعریف کنید." : "موجودی بحرانی ثبت‌شده‌ای دیده نمی‌شود.", purchases.Sum(x=>x.TotalRial-x.PaidRial)>0 ? "بدهی تأمین‌کنندگان را با وصول مطالبات هماهنگ کنید." : "بدهی خرید ثبت‌شده‌ای در ۳۰ روز اخیر دیده نمی‌شود." }, note = "این تحلیل فقط از داده‌های ثبت‌شده استفاده می‌کند و جای رسیدگی حسابداری تخصصی را نمی‌گیرد." });
});
merchant.MapPost("/advisor/ask", async (AdvisorQuestion body, MajoraDb db, HttpContext c, IHttpClientFactory clients, IConfiguration config, IDataProtectionProvider protection) =>
{
    if (string.IsNullOrWhiteSpace(body.Question) || body.Question.Length > 1000) return Fail("پرسش باید بین ۱ تا ۱۰۰۰ نویسه باشد.");
    var tid = TenantId(c.User); var since = DateTime.UtcNow.AddDays(-30);
    var invoices = await db.Invoices.Where(x => x.TenantId == tid && x.Status == "issued" && x.PaymentStatus != "proforma" && x.IssuedAt >= since).ToListAsync();
    var purchases = await db.Purchases.Where(x => x.TenantId == tid && x.PurchasedAt >= since).Select(x => new { x.TotalRial, x.PaidRial }).ToListAsync();
    var expenses = await db.Expenses.Where(x => x.TenantId == tid && !x.Voided && x.IncurredAt >= since).Select(x => x.AmountRial).ToListAsync();
    var lowStock = await db.Products.Where(x => x.TenantId == tid && !x.Archived && x.Stock <= 3).CountAsync();
    var facts = new { periodDays = 30, invoiceCount = invoices.Count, salesRial = invoices.Sum(x => x.TotalRial - x.ReturnedRial), outstandingRial = invoices.Sum(FinanceMath.Receivable), refundDueRial = invoices.Sum(FinanceMath.RefundDue), purchasesRial = purchases.Sum(x => x.TotalRial), supplierPayableRial = purchases.Sum(x => x.TotalRial - x.PaidRial), expensesRial = expenses.Sum(), lowStockCount = lowStock };
    var profile = await db.AiProviderProfiles.AsNoTracking().SingleOrDefaultAsync(x => x.Id == 1);
    var endpoint = profile is null ? config["MAJORA_AI_ENDPOINT"] : profile.Enabled ? profile.Endpoint : null;
    var model = profile is null ? config["MAJORA_AI_MODEL"] : profile.Enabled ? profile.Model : null;
    string? key;
    try { key = profile is null ? config["MAJORA_AI_API_KEY"] : profile.Enabled ? protection.CreateProtector("ai-provider-key-v1").Unprotect(profile.ProtectedApiKey) : null; }
    catch (System.Security.Cryptography.CryptographicException) { return Fail("کلید سرویس هوش مصنوعی قابل بازیابی نیست؛ تنظیمات را دوباره ثبت کنید.", 503); }
    if (string.IsNullOrWhiteSpace(endpoint) || string.IsNullOrWhiteSpace(key) || string.IsNullOrWhiteSpace(model))
        return Results.Ok(new { answer = $"در ۳۰ روز اخیر {facts.invoiceCount} فاکتور و {facts.salesRial:N0} ریال فروش ثبت شده است. ماندهٔ باز {facts.outstandingRial:N0} ریال است و {facts.lowStockCount} کالا موجودی پایین دارند. برای پاسخ تحلیلی آزاد، مدیر ماژورا باید ارائه‌دهندهٔ هوش مصنوعی را روی سرور تنظیم کند.", facts, source = "rules" });
    if (!AiEndpointGuard.ValidUri(endpoint, out var uri)) return Fail("تنظیمات سرویس هوش مصنوعی نامعتبر است.", 503);
    using var client = clients.CreateClient("ai");
    using var request = new HttpRequestMessage(HttpMethod.Post, uri);
    request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", key);
    request.Content = JsonContent.Create(new { model, temperature = 0.2, max_tokens = 700, messages = new object[] {
        new { role = "system", content = "تو مشاور فارسی کسب‌وکار MAJORA هستی. فقط از آمار خلاصهٔ ارائه‌شده استفاده کن. دادهٔ ناموجود را حدس نزن. دستور مالی قطعی یا اقدام خودکار نده. ۲ تا ۴ پیشنهاد عملی و دلیل هرکدام را کوتاه بگو. داده‌ها ممکن است ناقص باشند." },
        new { role = "user", content = $"آمار ۳۰ روز: {JsonSerializer.Serialize(facts)}\nپرسش کاربر: {body.Question}" }
    }});
    try
    {
        using var response = await client.SendAsync(request, c.RequestAborted);
        if (!response.IsSuccessStatusCode) return Fail("سرویس تحلیل فعلاً پاسخ نمی‌دهد.", 503);
        using var doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(c.RequestAborted), cancellationToken: c.RequestAborted);
        var answer = doc.RootElement.GetProperty("choices")[0].GetProperty("message").GetProperty("content").GetString();
        return Results.Ok(new { answer, facts, source = "ai" });
    }
    catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or KeyNotFoundException or JsonException or ArgumentOutOfRangeException) { return Fail("پاسخ سرویس تحلیل معتبر نبود یا اتصال برقرار نشد.", 503); }
}).RequireRateLimiting("login");
app.MapFallbackToFile("index.html");
app.Run();

public sealed record LoginRequest(string Username, string Password);
public sealed record PlanRequest(string Name, long MonthlyRial, int MaxUsers, bool Enabled = true);
public sealed record TenantRequest(string Name, string Slug, string OwnerUsername, string OwnerName, string OwnerPassword, string? BrandColor, bool ClassicPreset = false);
public sealed record TenantUpdate(string Name, bool Enabled, string? BrandColor, string? LogoUrl);
public sealed record SubscriptionRequest(Guid PlanId, DateTime StartsAt, DateTime EndsAt, string PaymentStatus, long? PriceRial, string? Note);
public sealed record ProductRequest(string Name, string Sku, string Category, long PriceRial, long Stock, long? AverageCostRial = null);
public sealed record CustomerRequest(string Name, string Phone);
public sealed record InvoiceRequest(string IdempotencyKey, Guid? CustomerId, string CustomerName, string CustomerPhone, string PaymentStatus, long PaidRial, DateTime? DueAt, List<InvoiceLineRequest> Lines);
public sealed record InvoiceLineRequest(Guid ProductId, long Quantity);
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
public sealed record PurchaseRequest(string IdempotencyKey, string SupplierName, string? SupplierInvoiceNumber, long PaidRial, DateTime? DueAt, List<PurchaseLineRequest> Lines);
public sealed record PurchaseLineRequest(Guid ProductId, long Quantity, long UnitCostRial);
public sealed record ExpenseRequest(string Category, string? Description, long AmountRial);
