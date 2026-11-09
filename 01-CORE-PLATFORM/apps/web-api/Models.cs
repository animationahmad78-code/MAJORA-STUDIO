using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Majora.WebApi;

public sealed class Tenant { public Guid Id { get; set; } = Guid.NewGuid(); public string Name { get; set; } = ""; public string Slug { get; set; } = ""; public string BrandColor { get; set; } = "#0B2B53"; public string? LogoUrl { get; set; } public bool Enabled { get; set; } = true; public long NextInvoiceNumber { get; set; } = 1; public DateTime CreatedAt { get; set; } = DateTime.UtcNow; }
public sealed class InvoiceBrandProfile { public Guid TenantId { get; set; } public int Revision { get; set; } = 1; public string StoreName { get; set; } = ""; public string Slogan { get; set; } = ""; public string Phone { get; set; } = ""; public string Address { get; set; } = ""; public string Card { get; set; } = ""; public string CardHolder { get; set; } = ""; public string Note { get; set; } = ""; public string ConditionsJson { get; set; } = "[]"; public string SocialTelegram { get; set; } = ""; public string SocialInstagram { get; set; } = ""; public string SocialContact { get; set; } = ""; public string? LogoDataUrl { get; set; } public DateTime UpdatedAt { get; set; } = DateTime.UtcNow; }
public sealed class AppUser { public Guid Id { get; set; } = Guid.NewGuid(); public Guid? TenantId { get; set; } public string Username { get; set; } = ""; public string PasswordHash { get; set; } = ""; public string DisplayName { get; set; } = ""; public string Role { get; set; } = "staff"; public bool Enabled { get; set; } = true; public int AuthVersion { get; set; } public DateTime CreatedAt { get; set; } = DateTime.UtcNow; }
public sealed class Plan { public Guid Id { get; set; } = Guid.NewGuid(); public string Name { get; set; } = ""; public long MonthlyRial { get; set; } public int MaxUsers { get; set; } = 3; public bool Enabled { get; set; } = true; }
public sealed class Subscription { public Guid Id { get; set; } = Guid.NewGuid(); public Guid TenantId { get; set; } public Guid PlanId { get; set; } public DateTime StartsAt { get; set; } public DateTime EndsAt { get; set; } public string PaymentStatus { get; set; } = "pending"; public long PriceRialSnapshot { get; set; } public string Note { get; set; } = ""; }
public sealed class Product { public Guid Id { get; set; } = Guid.NewGuid(); public Guid TenantId { get; set; } public string Name { get; set; } = ""; public string Sku { get; set; } = ""; public string Category { get; set; } = ""; public long PriceRial { get; set; } public long AverageCostRial { get; set; } public bool CostKnown { get; set; } public long Stock { get; set; } public bool Archived { get; set; } public bool HasPhoto { get; set; } public DateTime UpdatedAt { get; set; } = DateTime.UtcNow; }
public sealed class ProductPhoto { public Guid ProductId { get; set; } public Guid TenantId { get; set; } public string ContentType { get; set; } = ""; public byte[] Bytes { get; set; } = []; }
public sealed class PriceBatch { public Guid Id { get; set; } = Guid.NewGuid(); public Guid TenantId { get; set; } public string IdempotencyKey { get; set; } = ""; public decimal Percent { get; set; } public DateTime CreatedAt { get; set; } = DateTime.UtcNow; public DateTime? RevertedAt { get; set; } public List<PriceBatchLine> Lines { get; set; } = []; }
public sealed class PriceBatchLine { public Guid Id { get; set; } = Guid.NewGuid(); public Guid PriceBatchId { get; set; } public Guid ProductId { get; set; } public string NameSnapshot { get; set; } = ""; public long OldPriceRial { get; set; } public long NewPriceRial { get; set; } }
public sealed class Customer { public Guid Id { get; set; } = Guid.NewGuid(); public Guid TenantId { get; set; } public string Name { get; set; } = ""; public string Phone { get; set; } = ""; public bool Archived { get; set; } public DateTime CreatedAt { get; set; } = DateTime.UtcNow; }
public sealed class Invoice { public Guid Id { get; set; } = Guid.NewGuid(); public Guid TenantId { get; set; } public long Number { get; set; } public Guid? CustomerId { get; set; } public string CustomerName { get; set; } = ""; public string CustomerPhone { get; set; } = ""; public DateTime IssuedAt { get; set; } = DateTime.UtcNow; public string Status { get; set; } = "issued"; public string PaymentStatus { get; set; } = "unpaid"; public int Revision { get; set; } = 1; public long TotalRial { get; set; } public long PaidRial { get; set; } public long ReturnedRial { get; set; } public long RefundedRial { get; set; } public bool Archived { get; set; } public string IdempotencyKey { get; set; } = ""; public string BrandSnapshotJson { get; set; } = ""; public List<InvoiceLine> Lines { get; set; } = []; }
public sealed class InvoiceRevision { public Guid Id { get; set; } = Guid.NewGuid(); public Guid TenantId { get; set; } public Guid InvoiceId { get; set; } public int RevisionNo { get; set; } public string SnapshotJson { get; set; } = ""; public string Reason { get; set; } = ""; public DateTime RecordedAt { get; set; } = DateTime.UtcNow; }
public sealed class InvoiceLine { public Guid Id { get; set; } = Guid.NewGuid(); public Guid InvoiceId { get; set; } public Guid? ProductId { get; set; } public string NameSnapshot { get; set; } = ""; public long UnitPriceRial { get; set; } public long Quantity { get; set; } public long ReturnedQuantity { get; set; } public long TotalRial { get; set; } public long UnitCostRialSnapshot { get; set; } public bool CostKnown { get; set; } }
public sealed class Payment { public Guid Id { get; set; } = Guid.NewGuid(); public Guid TenantId { get; set; } public Guid InvoiceId { get; set; } public string? IdempotencyKey { get; set; } public long AmountRial { get; set; } public string Method { get; set; } = "cash"; public string Reference { get; set; } = ""; public DateTime ReceivedAt { get; set; } = DateTime.UtcNow; }
public sealed class SalesReturn { public Guid Id { get; set; } = Guid.NewGuid(); public Guid TenantId { get; set; } public Guid InvoiceId { get; set; } public string IdempotencyKey { get; set; } = ""; public string Reason { get; set; } = ""; public long AmountRial { get; set; } public DateTime CreatedAt { get; set; } = DateTime.UtcNow; public List<SalesReturnLine> Lines { get; set; } = []; }
public sealed class SalesReturnLine { public Guid Id { get; set; } = Guid.NewGuid(); public Guid SalesReturnId { get; set; } public Guid InvoiceLineId { get; set; } public Guid? ProductId { get; set; } public string NameSnapshot { get; set; } = ""; public long Quantity { get; set; } public long AmountRial { get; set; } public long UnitCostRialSnapshot { get; set; } public bool CostKnown { get; set; } public bool Restocked { get; set; } }
public sealed class Refund { public Guid Id { get; set; } = Guid.NewGuid(); public Guid TenantId { get; set; } public Guid InvoiceId { get; set; } public string IdempotencyKey { get; set; } = ""; public long AmountRial { get; set; } public string Method { get; set; } = "cash"; public string Reference { get; set; } = ""; public DateTime RefundedAt { get; set; } = DateTime.UtcNow; }
public sealed class StockMovement { public Guid Id { get; set; } = Guid.NewGuid(); public Guid TenantId { get; set; } public Guid ProductId { get; set; } public Guid? InvoiceId { get; set; } public long Delta { get; set; } public string Reason { get; set; } = ""; public DateTime CreatedAt { get; set; } = DateTime.UtcNow; }
public sealed class Reminder { public Guid Id { get; set; } = Guid.NewGuid(); public Guid TenantId { get; set; } public string Title { get; set; } = ""; public DateTime DueAt { get; set; } public bool Done { get; set; } public Guid? InvoiceId { get; set; } }
public sealed class AuditEntry { public Guid Id { get; set; } = Guid.NewGuid(); public Guid? TenantId { get; set; } public Guid ActorId { get; set; } public string Action { get; set; } = ""; public string EntityType { get; set; } = ""; public string EntityId { get; set; } = ""; public string Detail { get; set; } = ""; public DateTime At { get; set; } = DateTime.UtcNow; }
public sealed class Purchase { public Guid Id { get; set; } = Guid.NewGuid(); public Guid TenantId { get; set; } public string SupplierName { get; set; } = ""; public string SupplierInvoiceNumber { get; set; } = ""; public DateTime PurchasedAt { get; set; } = DateTime.UtcNow; public long TotalRial { get; set; } public long PaidRial { get; set; } public string IdempotencyKey { get; set; } = ""; public List<PurchaseLine> Lines { get; set; } = []; }
public sealed class PurchaseLine { public Guid Id { get; set; } = Guid.NewGuid(); public Guid PurchaseId { get; set; } public Guid ProductId { get; set; } public string NameSnapshot { get; set; } = ""; public long Quantity { get; set; } public long UnitCostRial { get; set; } public long TotalRial { get; set; } }
public sealed class PurchasePayment { public Guid Id { get; set; } = Guid.NewGuid(); public Guid TenantId { get; set; } public Guid PurchaseId { get; set; } public long AmountRial { get; set; } public string Method { get; set; } = "cash"; public DateTime PaidAt { get; set; } = DateTime.UtcNow; }
public sealed class Expense { public Guid Id { get; set; } = Guid.NewGuid(); public Guid TenantId { get; set; } public string Category { get; set; } = ""; public string Description { get; set; } = ""; public long AmountRial { get; set; } public DateTime IncurredAt { get; set; } = DateTime.UtcNow; public bool Voided { get; set; } }
public sealed class Cheque { public Guid Id { get; set; } = Guid.NewGuid(); public Guid TenantId { get; set; } public Guid? InvoiceId { get; set; } public string Direction { get; set; } = "received"; public string Party { get; set; } = ""; public string Serial { get; set; } = ""; public string Bank { get; set; } = ""; public long AmountRial { get; set; } public DateTime DueAt { get; set; } public string SayadId { get; set; } = ""; public string IssuerNationalId { get; set; } = ""; public string BeneficiaryNationalId { get; set; } = ""; public string RegistrationStatus { get; set; } = "unknown"; public string Status { get; set; } = "open"; public string Note { get; set; } = ""; public bool ShowDetails { get; set; } public bool ShowImage { get; set; } public string? PhotoContentType { get; set; } public byte[]? PhotoBytes { get; set; } public DateTime CreatedAt { get; set; } = DateTime.UtcNow; public DateTime UpdatedAt { get; set; } = DateTime.UtcNow; }
public sealed class AiProviderProfile { public int Id { get; set; } = 1; public string Endpoint { get; set; } = ""; public string Model { get; set; } = ""; public string ProtectedApiKey { get; set; } = ""; public bool Enabled { get; set; } public DateTime UpdatedAt { get; set; } = DateTime.UtcNow; }

public sealed class MajoraDb(DbContextOptions<MajoraDb> options) : DbContext(options)
{
    public DbSet<AiProviderProfile> AiProviderProfiles => Set<AiProviderProfile>();
    public DbSet<Tenant> Tenants => Set<Tenant>(); public DbSet<InvoiceBrandProfile> InvoiceBrands => Set<InvoiceBrandProfile>(); public DbSet<AppUser> Users => Set<AppUser>(); public DbSet<Plan> Plans => Set<Plan>(); public DbSet<Subscription> Subscriptions => Set<Subscription>(); public DbSet<Product> Products => Set<Product>(); public DbSet<ProductPhoto> ProductPhotos => Set<ProductPhoto>(); public DbSet<PriceBatch> PriceBatches => Set<PriceBatch>(); public DbSet<PriceBatchLine> PriceBatchLines => Set<PriceBatchLine>(); public DbSet<Customer> Customers => Set<Customer>(); public DbSet<Invoice> Invoices => Set<Invoice>(); public DbSet<InvoiceRevision> InvoiceRevisions => Set<InvoiceRevision>(); public DbSet<InvoiceLine> InvoiceLines => Set<InvoiceLine>(); public DbSet<Payment> Payments => Set<Payment>(); public DbSet<SalesReturn> SalesReturns => Set<SalesReturn>(); public DbSet<SalesReturnLine> SalesReturnLines => Set<SalesReturnLine>(); public DbSet<Refund> Refunds => Set<Refund>(); public DbSet<StockMovement> StockMovements => Set<StockMovement>(); public DbSet<Reminder> Reminders => Set<Reminder>(); public DbSet<AuditEntry> Audit => Set<AuditEntry>(); public DbSet<Purchase> Purchases => Set<Purchase>(); public DbSet<PurchaseLine> PurchaseLines => Set<PurchaseLine>(); public DbSet<PurchasePayment> PurchasePayments => Set<PurchasePayment>(); public DbSet<Expense> Expenses => Set<Expense>(); public DbSet<Cheque> Cheques => Set<Cheque>();
    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<AiProviderProfile>().Property(x => x.Endpoint).HasMaxLength(500);
        b.Entity<AiProviderProfile>().Property(x => x.Model).HasMaxLength(120);
        b.Entity<Tenant>().Property(x => x.Slug).HasMaxLength(40);
        b.Entity<AppUser>().Property(x => x.Username).HasMaxLength(100);
        b.Entity<Product>().Property(x => x.Sku).HasMaxLength(100);
        b.Entity<Invoice>().Property(x => x.IdempotencyKey).HasMaxLength(100);
        b.Entity<Purchase>().Property(x => x.IdempotencyKey).HasMaxLength(100);
        b.Entity<Tenant>().Property(x => x.Name).HasMaxLength(200);
        b.Entity<InvoiceBrandProfile>().HasKey(x => x.TenantId);
        b.Entity<InvoiceBrandProfile>().Property(x => x.StoreName).HasMaxLength(200);
        b.Entity<InvoiceBrandProfile>().Property(x => x.Revision).IsConcurrencyToken();
        b.Entity<AppUser>().Property(x => x.DisplayName).HasMaxLength(200);
        b.Entity<Product>().Property(x => x.Name).HasMaxLength(300);
        b.Entity<Customer>().Property(x => x.Name).HasMaxLength(200);
        b.Entity<Customer>().Property(x => x.Phone).HasMaxLength(30);
        b.Entity<Invoice>().Property(x => x.CustomerName).HasMaxLength(200);
        b.Entity<Invoice>().Property(x => x.CustomerPhone).HasMaxLength(30);
        b.Entity<Invoice>().Property(x => x.Revision).HasDefaultValue(1).IsConcurrencyToken();
        b.Entity<InvoiceRevision>().HasIndex(x => new { x.TenantId, x.InvoiceId, x.RevisionNo }).IsUnique();
        b.Entity<InvoiceRevision>().Property(x => x.Reason).HasMaxLength(500);
        b.Entity<InvoiceRevision>().HasOne<Invoice>().WithMany().HasForeignKey(x => x.InvoiceId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Tenant>().HasIndex(x => x.Slug).IsUnique();
        b.Entity<AppUser>().HasIndex(x => x.Username).IsUnique();
        b.Entity<Subscription>().HasIndex(x => new { x.TenantId, x.EndsAt });
        b.Entity<Product>().HasIndex(x => new { x.TenantId, x.Sku }).IsUnique();
        b.Entity<ProductPhoto>().HasKey(x => x.ProductId);
        b.Entity<ProductPhoto>().Property(x => x.ContentType).HasMaxLength(30);
        b.Entity<ProductPhoto>().HasOne<Product>().WithOne().HasForeignKey<ProductPhoto>(x => x.ProductId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<PriceBatch>().HasIndex(x => new { x.TenantId, x.IdempotencyKey }).IsUnique();
        b.Entity<PriceBatch>().Property(x => x.IdempotencyKey).HasMaxLength(100);
        b.Entity<PriceBatch>().Property(x => x.Percent).HasPrecision(8, 3);
        b.Entity<PriceBatchLine>().HasOne<PriceBatch>().WithMany(x => x.Lines).HasForeignKey(x => x.PriceBatchId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<PriceBatchLine>().HasIndex(x => new { x.PriceBatchId, x.ProductId }).IsUnique();
        b.Entity<Customer>().HasIndex(x => new { x.TenantId, x.Phone });
        b.Entity<Invoice>().HasIndex(x => new { x.TenantId, x.Number }).IsUnique();
        b.Entity<Invoice>().HasIndex(x => new { x.TenantId, x.IdempotencyKey }).IsUnique();
        b.Entity<InvoiceLine>().HasOne<Invoice>().WithMany(x => x.Lines).HasForeignKey(x => x.InvoiceId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Invoice>().Property(x => x.ReturnedRial).HasDefaultValue(0);
        b.Entity<Invoice>().Property(x => x.RefundedRial).HasDefaultValue(0);
        b.Entity<InvoiceLine>().Property(x => x.ReturnedQuantity).HasDefaultValue(0);
        b.Entity<SalesReturn>().HasIndex(x => new { x.TenantId, x.IdempotencyKey }).IsUnique();
        b.Entity<SalesReturn>().HasIndex(x => new { x.TenantId, x.CreatedAt });
        b.Entity<SalesReturn>().Property(x => x.IdempotencyKey).HasMaxLength(100);
        b.Entity<SalesReturn>().Property(x => x.Reason).HasMaxLength(500);
        b.Entity<SalesReturnLine>().Property(x => x.NameSnapshot).HasMaxLength(300);
        b.Entity<SalesReturnLine>().HasOne<SalesReturn>().WithMany(x => x.Lines).HasForeignKey(x => x.SalesReturnId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Refund>().HasIndex(x => new { x.TenantId, x.IdempotencyKey }).IsUnique();
        b.Entity<Refund>().HasIndex(x => new { x.TenantId, x.InvoiceId });
        b.Entity<Refund>().Property(x => x.IdempotencyKey).HasMaxLength(100);
        b.Entity<Refund>().Property(x => x.Method).HasMaxLength(40);
        b.Entity<Refund>().Property(x => x.Reference).HasMaxLength(200);
        b.Entity<PurchaseLine>().HasOne<Purchase>().WithMany(x => x.Lines).HasForeignKey(x => x.PurchaseId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Purchase>().HasIndex(x => new { x.TenantId, x.IdempotencyKey }).IsUnique();
        b.Entity<Purchase>().HasIndex(x => new { x.TenantId, x.PurchasedAt });
        b.Entity<PurchasePayment>().HasIndex(x => new { x.TenantId, x.PurchaseId });
        b.Entity<Expense>().HasIndex(x => new { x.TenantId, x.IncurredAt });
        b.Entity<Cheque>().HasIndex(x => new { x.TenantId, x.DueAt, x.Status });
        b.Entity<Cheque>().HasIndex(x => new { x.TenantId, x.InvoiceId }).IsUnique().HasFilter("[InvoiceId] IS NOT NULL");
        b.Entity<Cheque>().HasIndex(x => new { x.TenantId, x.SayadId }).IsUnique().HasFilter("[SayadId] <> ''");
        b.Entity<Cheque>().HasOne<Invoice>().WithMany().HasForeignKey(x => x.InvoiceId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Cheque>().Property(x => x.Party).HasMaxLength(200);
        b.Entity<Cheque>().Property(x => x.Serial).HasMaxLength(80);
        b.Entity<Cheque>().Property(x => x.Bank).HasMaxLength(120);
        b.Entity<Cheque>().Property(x => x.SayadId).HasMaxLength(16);
        b.Entity<Cheque>().Property(x => x.IssuerNationalId).HasMaxLength(10);
        b.Entity<Cheque>().Property(x => x.BeneficiaryNationalId).HasMaxLength(10);
        b.Entity<Cheque>().Property(x => x.RegistrationStatus).HasMaxLength(20);
        b.Entity<Cheque>().Property(x => x.Status).HasMaxLength(20);
        b.Entity<Cheque>().Property(x => x.Direction).HasMaxLength(20);
        b.Entity<Cheque>().Property(x => x.Note).HasMaxLength(500);
        b.Entity<Cheque>().Property(x => x.PhotoContentType).HasMaxLength(30);
        b.Entity<Payment>().HasIndex(x => new { x.TenantId, x.InvoiceId });
        b.Entity<Payment>().Property(x => x.IdempotencyKey).HasMaxLength(100);
        b.Entity<Payment>().HasIndex(x => new { x.TenantId, x.IdempotencyKey }).IsUnique();
        b.Entity<AuditEntry>().HasIndex(x => new { x.TenantId, x.At });
        b.Entity<Reminder>().HasIndex(x => new { x.TenantId, x.DueAt });
    }
}

// Production migrations target SQL Server. Development SQLite uses EnsureCreated in Development only.
public sealed class MajoraDesignFactory : IDesignTimeDbContextFactory<MajoraDb>
{
    public MajoraDb CreateDbContext(string[] args) => new(new DbContextOptionsBuilder<MajoraDb>()
        .UseSqlServer("Server=(localdb)\\mssqllocaldb;Database=MajoraDesign;Trusted_Connection=True;")
        .Options);
}
