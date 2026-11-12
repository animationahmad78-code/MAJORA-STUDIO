using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Majora.WebApi.Migrations
{
    /// <inheritdoc />
    public partial class IdempotentPurchasePayments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "IdempotencyKey",
                table: "PurchasePayments",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RequestHash",
                table: "PurchasePayments",
                type: "nvarchar(64)",
                maxLength: 64,
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateIndex(
                name: "IX_PurchasePayments_TenantId_IdempotencyKey",
                table: "PurchasePayments",
                columns: new[] { "TenantId", "IdempotencyKey" },
                unique: true,
                filter: "[IdempotencyKey] IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PurchasePayments_TenantId_IdempotencyKey",
                table: "PurchasePayments");

            migrationBuilder.DropColumn(
                name: "IdempotencyKey",
                table: "PurchasePayments");

            migrationBuilder.DropColumn(
                name: "RequestHash",
                table: "PurchasePayments");
        }
    }
}
