using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Majora.WebApi.Migrations
{
    /// <inheritdoc />
    public partial class InvoiceBrandSnapshot : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "BrandSnapshotJson",
                table: "Invoices",
                type: "nvarchar(max)",
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateTable(
                name: "InvoiceBrands",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Revision = table.Column<int>(type: "int", nullable: false),
                    StoreName = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Slogan = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Phone = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Address = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Card = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    CardHolder = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Note = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    ConditionsJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    SocialTelegram = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    SocialInstagram = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    SocialContact = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    LogoDataUrl = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InvoiceBrands", x => x.TenantId);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "InvoiceBrands");

            migrationBuilder.DropColumn(
                name: "BrandSnapshotJson",
                table: "Invoices");
        }
    }
}
