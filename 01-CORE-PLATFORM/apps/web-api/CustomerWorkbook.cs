using System.IO.Compression;
using System.Text;
using System.Xml;

namespace Majora.WebApi;

internal static class CustomerWorkbook
{
    private static readonly string[] Headers =
    [
        "ردیف", "نام و نام خانوادگی", "شماره تماس", "نشانی", "شغل", "نحوهٔ آشنایی", "شماره معرف", "یادداشت"
    ];

    internal static byte[] Create(IReadOnlyList<Customer> customers)
    {
        using var buffer = new MemoryStream();
        using (var archive = new ZipArchive(buffer, ZipArchiveMode.Create, leaveOpen: true))
        {
            Write(archive, "[Content_Types].xml", writer =>
            {
                writer.WriteStartElement("Types", "http://schemas.openxmlformats.org/package/2006/content-types");
                ContentType(writer, "rels", "application/vnd.openxmlformats-package.relationships+xml");
                ContentType(writer, "xml", "application/xml");
                Override(writer, "/xl/workbook.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml");
                Override(writer, "/xl/worksheets/sheet1.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml");
                writer.WriteEndElement();
            });
            Write(archive, "_rels/.rels", writer =>
            {
                writer.WriteStartElement("Relationships", "http://schemas.openxmlformats.org/package/2006/relationships");
                Relationship(writer, "rId1", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument", "xl/workbook.xml");
                writer.WriteEndElement();
            });
            Write(archive, "xl/workbook.xml", writer =>
            {
                writer.WriteStartElement("workbook", "http://schemas.openxmlformats.org/spreadsheetml/2006/main");
                writer.WriteStartElement("sheets");
                writer.WriteStartElement("sheet");
                writer.WriteAttributeString("name", "مشتریان");
                writer.WriteAttributeString("sheetId", "1");
                writer.WriteAttributeString("r", "id", "http://schemas.openxmlformats.org/officeDocument/2006/relationships", "rId1");
                writer.WriteEndElement();
                writer.WriteEndElement();
                writer.WriteEndElement();
            });
            Write(archive, "xl/_rels/workbook.xml.rels", writer =>
            {
                writer.WriteStartElement("Relationships", "http://schemas.openxmlformats.org/package/2006/relationships");
                Relationship(writer, "rId1", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet", "worksheets/sheet1.xml");
                writer.WriteEndElement();
            });
            Write(archive, "xl/worksheets/sheet1.xml", writer =>
            {
                writer.WriteStartElement("worksheet", "http://schemas.openxmlformats.org/spreadsheetml/2006/main");
                writer.WriteStartElement("sheetViews");
                writer.WriteStartElement("sheetView");
                writer.WriteAttributeString("workbookViewId", "0");
                writer.WriteAttributeString("rightToLeft", "1");
                writer.WriteStartElement("pane");
                writer.WriteAttributeString("ySplit", "1");
                writer.WriteAttributeString("topLeftCell", "A2");
                writer.WriteAttributeString("state", "frozen");
                writer.WriteEndElement();
                writer.WriteEndElement();
                writer.WriteEndElement();
                writer.WriteStartElement("cols");
                foreach (var (column, width) in new[] { 9d, 28d, 19d, 40d, 20d, 22d, 19d, 38d }.Select((width, index) => (index + 1, width)))
                {
                    writer.WriteStartElement("col");
                    writer.WriteAttributeString("min", column.ToString());
                    writer.WriteAttributeString("max", column.ToString());
                    writer.WriteAttributeString("width", width.ToString(System.Globalization.CultureInfo.InvariantCulture));
                    writer.WriteAttributeString("customWidth", "1");
                    writer.WriteEndElement();
                }
                writer.WriteEndElement();
                writer.WriteStartElement("sheetData");
                Row(writer, 1, Headers);
                for (var index = 0; index < customers.Count; index++)
                {
                    var customer = customers[index];
                    Row(writer, index + 2,
                    [
                        (index + 1).ToString(), customer.Name, customer.Phone, customer.Address,
                        customer.Occupation, customer.AcquisitionSource, customer.ReferrerPhone, customer.Notes
                    ], numericFirst: true);
                }
                writer.WriteEndElement();
                writer.WriteStartElement("autoFilter");
                writer.WriteAttributeString("ref", $"A1:H{customers.Count + 1}");
                writer.WriteEndElement();
                writer.WriteEndElement();
            });
        }
        return buffer.ToArray();
    }

    private static void Row(XmlWriter writer, int row, IReadOnlyList<string> values, bool numericFirst = false)
    {
        writer.WriteStartElement("row");
        writer.WriteAttributeString("r", row.ToString());
        for (var index = 0; index < values.Count; index++)
        {
            writer.WriteStartElement("c");
            writer.WriteAttributeString("r", $"{(char)('A' + index)}{row}");
            if (numericFirst && index == 0) writer.WriteElementString("v", values[index]);
            else
            {
                writer.WriteAttributeString("t", "inlineStr");
                writer.WriteStartElement("is");
                writer.WriteElementString("t", Clean(values[index]));
                writer.WriteEndElement();
            }
            writer.WriteEndElement();
        }
        writer.WriteEndElement();
    }

    private static string Clean(string? value)
    {
        if (string.IsNullOrEmpty(value)) return "";
        var clean = new StringBuilder(value.Length);
        foreach (var ch in value)
            if (ch == '\t' || ch == '\n' || ch == '\r' || ch >= ' ' && ch != '\uFFFE' && ch != '\uFFFF') clean.Append(ch);
        return clean.ToString();
    }

    private static void ContentType(XmlWriter writer, string extension, string type)
    {
        writer.WriteStartElement("Default");
        writer.WriteAttributeString("Extension", extension);
        writer.WriteAttributeString("ContentType", type);
        writer.WriteEndElement();
    }

    private static void Override(XmlWriter writer, string name, string type)
    {
        writer.WriteStartElement("Override");
        writer.WriteAttributeString("PartName", name);
        writer.WriteAttributeString("ContentType", type);
        writer.WriteEndElement();
    }

    private static void Relationship(XmlWriter writer, string id, string type, string target)
    {
        writer.WriteStartElement("Relationship");
        writer.WriteAttributeString("Id", id);
        writer.WriteAttributeString("Type", type);
        writer.WriteAttributeString("Target", target);
        writer.WriteEndElement();
    }

    private static void Write(ZipArchive archive, string path, Action<XmlWriter> write)
    {
        var entry = archive.CreateEntry(path, CompressionLevel.Fastest);
        using var stream = entry.Open();
        using var writer = XmlWriter.Create(stream, new XmlWriterSettings { Encoding = new UTF8Encoding(false), CloseOutput = false });
        writer.WriteStartDocument();
        write(writer);
        writer.WriteEndDocument();
    }
}
