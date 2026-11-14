using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Majora.WebApi.Migrations
{
    /// <inheritdoc />
    public partial class ChequeRegister : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Cheques",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    TenantId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    InvoiceId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    Direction = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    Party = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Serial = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    Bank = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    AmountRial = table.Column<long>(type: "bigint", nullable: false),
                    DueAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    SayadId = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    IssuerNationalId = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    BeneficiaryNationalId = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    RegistrationStatus = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    Status = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    Note = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    ShowDetails = table.Column<bool>(type: "bit", nullable: false),
                    ShowImage = table.Column<bool>(type: "bit", nullable: false),
                    PhotoContentType = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: true),
                    PhotoBytes = table.Column<byte[]>(type: "varbinary(max)", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Cheques", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Cheques_Invoices_InvoiceId",
                        column: x => x.InvoiceId,
                        principalTable: "Invoices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Cheques_InvoiceId",
                table: "Cheques",
                column: "InvoiceId");

            migrationBuilder.CreateIndex(
                name: "IX_Cheques_TenantId_DueAt_Status",
                table: "Cheques",
                columns: new[] { "TenantId", "DueAt", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_Cheques_TenantId_InvoiceId",
                table: "Cheques",
                columns: new[] { "TenantId", "InvoiceId" },
                unique: true,
                filter: "[InvoiceId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Cheques_TenantId_SayadId",
                table: "Cheques",
                columns: new[] { "TenantId", "SayadId" },
                unique: true,
                filter: "[SayadId] <> ''");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Cheques");
        }
    }
}
