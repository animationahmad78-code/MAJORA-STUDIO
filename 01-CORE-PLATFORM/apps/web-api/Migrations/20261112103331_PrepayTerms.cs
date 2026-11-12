using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Majora.WebApi.Migrations
{
    /// <inheritdoc />
    public partial class PrepayTerms : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "Months",
                table: "SubscriptionOrders",
                type: "int",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<decimal>(
                name: "TermDiscountPercentSnapshot",
                table: "SubscriptionOrders",
                type: "decimal(5,2)",
                precision: 5,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<int>(
                name: "MaxPrepayMonths",
                table: "Plans",
                type: "int",
                nullable: false,
                defaultValue: 6);

            migrationBuilder.AddColumn<string>(
                name: "PrepayDiscountsJson",
                table: "Plans",
                type: "nvarchar(max)",
                nullable: false,
                defaultValue: "{}");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Months",
                table: "SubscriptionOrders");

            migrationBuilder.DropColumn(
                name: "TermDiscountPercentSnapshot",
                table: "SubscriptionOrders");

            migrationBuilder.DropColumn(
                name: "MaxPrepayMonths",
                table: "Plans");

            migrationBuilder.DropColumn(
                name: "PrepayDiscountsJson",
                table: "Plans");
        }
    }
}
