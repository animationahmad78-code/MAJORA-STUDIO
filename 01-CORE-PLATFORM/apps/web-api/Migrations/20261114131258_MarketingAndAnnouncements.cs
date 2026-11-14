using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Majora.WebApi.Migrations
{
    /// <inheritdoc />
    public partial class MarketingAndAnnouncements : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AnnouncementFonts",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Name = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    Bytes = table.Column<byte[]>(type: "varbinary(max)", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AnnouncementFonts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "AnnouncementReads",
                columns: table => new
                {
                    AnnouncementId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ReadAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AnnouncementReads", x => new { x.AnnouncementId, x.UserId });
                });

            migrationBuilder.CreateTable(
                name: "Announcements",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Title = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false),
                    Body = table.Column<string>(type: "nvarchar(max)", maxLength: 6000, nullable: false),
                    Alignment = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    FontSize = table.Column<int>(type: "int", nullable: false),
                    FontId = table.Column<int>(type: "int", nullable: true),
                    ImageContentType = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    ImageBytes = table.Column<byte[]>(type: "varbinary(max)", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Announcements", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "MarketingSlides",
                columns: table => new
                {
                    Slot = table.Column<int>(type: "int", nullable: false),
                    AltText = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false),
                    TargetUrl = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    LinkEnabled = table.Column<bool>(type: "bit", nullable: false),
                    Enabled = table.Column<bool>(type: "bit", nullable: false),
                    ImageContentType = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false),
                    ImageBytes = table.Column<byte[]>(type: "varbinary(max)", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MarketingSlides", x => x.Slot);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AnnouncementReads_UserId",
                table: "AnnouncementReads",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AnnouncementFonts");

            migrationBuilder.DropTable(
                name: "AnnouncementReads");

            migrationBuilder.DropTable(
                name: "Announcements");

            migrationBuilder.DropTable(
                name: "MarketingSlides");
        }
    }
}
