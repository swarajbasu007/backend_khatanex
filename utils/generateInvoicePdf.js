const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const { UPLOAD_ROOT } = require("./upload");

/**
 * generateInvoicePdf — builds a downloadable invoice PDF and saves it to
 * uploads/invoices/<invoice_number>.pdf. Returns the absolute file path.
 *
 * @param {object} invoice   { invoice_number, invoice_date, subtotal, total_amount }
 * @param {object} customer  { name, phone, email }
 * @param {array}  items     [{ product_name, hsn_code, quantity, price, amount }]
 * @param {object} company   { company_name, address, gstin, logo_path } (logo_path is
 *                           a "/uploads/..." relative path as stored in DB, or null)
 */
const generateInvoicePdf = ({ invoice, customer, items, company }) => {
  return new Promise((resolve, reject) => {
    try {
      const fileName = `${invoice.invoice_number}.pdf`;
      const outPath = path.join(UPLOAD_ROOT, "invoices", fileName);
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const stream = fs.createWriteStream(outPath);
      doc.pipe(stream);

      // --- Header: logo + company info ---
      if (company.logo_path) {
        const absLogoPath = path.join(UPLOAD_ROOT, "..", company.logo_path.replace(/^\/uploads/, "uploads"));
        if (fs.existsSync(absLogoPath)) {
          try {
            doc.image(absLogoPath, 50, 45, { width: 90 });
          } catch (_) {
            /* if the logo file is corrupt/unsupported, just skip it silently */
          }
        }
      }

      doc
        .fontSize(18)
        .text(company.company_name || "FIRST TRACK KHATANEX", 160, 50, { align: "right" })
        .fontSize(9)
        .fillColor("#555")
        .text(company.address || "", 160, 72, { align: "right" })
        .text(company.gstin ? `GSTIN: ${company.gstin}` : "", 160, 86, { align: "right" })
        .fillColor("#000");

      doc.moveTo(50, 120).lineTo(545, 120).strokeColor("#ccc").stroke();

      // --- Invoice meta ---
      doc.fontSize(16).text("INVOICE", 50, 135);
      doc
        .fontSize(10)
        .text(`Invoice No: ${invoice.invoice_number}`, 50, 160)
        .text(`Date: ${new Date(invoice.invoice_date).toLocaleString("en-IN")}`, 50, 175);

      doc
        .fontSize(10)
        .text("Billed To:", 350, 160)
        .fontSize(11)
        .text(customer.name || "", 350, 175)
        .fontSize(9)
        .text(customer.phone || "", 350, 190)
        .text(customer.email || "", 350, 203);

      // --- Items table ---
      let y = 240;
      doc.fontSize(10).fillColor("#fff");
      doc.rect(50, y, 495, 20).fill("#333");
      doc
        .fillColor("#fff")
        .text("Item", 55, y + 6)
        .text("HSN", 230, y + 6)
        .text("Qty", 300, y + 6)
        .text("Price", 360, y + 6)
        .text("Amount", 450, y + 6);
      doc.fillColor("#000");
      y += 25;

      items.forEach((item, idx) => {
        if (idx % 2 === 1) {
          doc.rect(50, y - 4, 495, 20).fill("#f6f6f6");
          doc.fillColor("#000");
        }
        doc
          .fontSize(9)
          .text(String(item.product_name), 55, y, { width: 170 })
          .text(item.hsn_code || "-", 230, y)
          .text(String(item.quantity), 300, y)
          .text(`₹${Number(item.price).toFixed(2)}`, 360, y)
          .text(`₹${Number(item.amount).toFixed(2)}`, 450, y);
        y += 22;
      });

      doc.moveTo(50, y + 5).lineTo(545, y + 5).strokeColor("#ccc").stroke();
      y += 15;

      doc.fontSize(10).text("Subtotal:", 400, y).text(`₹${Number(invoice.subtotal).toFixed(2)}`, 480, y);
      y += 18;
      doc
        .fontSize(12)
        .text("Total:", 400, y, { continued: false })
        .text(`₹${Number(invoice.total_amount).toFixed(2)}`, 480, y);

      doc
        .fontSize(8)
        .fillColor("#888")
        .text("This is a system-generated invoice.", 50, 780, { align: "center", width: 495 });

      doc.end();

      stream.on("finish", () => resolve(outPath));
      stream.on("error", reject);
    } catch (err) {
      reject(err);
    }
  });
};

module.exports = { generateInvoicePdf };
