const path = require("path");
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const { generateInvoicePdf } = require("../utils/generateInvoicePdf");
const { sendMail } = require("../utils/mailer");
const { relativeUploadPath } = require("../utils/upload");

const getCompanySettings = async () => {
  const [rows] = await pool.query("SELECT * FROM company_settings WHERE id = 1");
  return (
    rows[0] || {
      company_name: process.env.COMPANY_NAME || "FIRST TRACK KHATANEX",
      address: process.env.COMPANY_ADDRESS || "",
      gstin: process.env.COMPANY_GSTIN || "",
      logo_path: null,
    }
  );
};

// POST /api/invoices
// body: { customer_id, items: [{ product_name, hsn_code, quantity, price }] }
// invoice_date is always "now" — never taken from the client, per spec.
const createInvoice = asyncHandler(async (req, res) => {
  const { customer_id, items } = req.body;

  if (!customer_id) throw new ApiError(400, "customer_id is required.");
  if (!Array.isArray(items) || !items.length) throw new ApiError(400, "At least one item is required.");

  for (const it of items) {
    if (!it.product_name) throw new ApiError(400, "Each item needs a product_name.");
    if (!it.price || Number(it.price) < 0) throw new ApiError(400, "Each item needs a valid price.");
    if (!it.quantity || Number(it.quantity) <= 0) throw new ApiError(400, "Each item needs a valid quantity.");
  }

  const [custRows] = await pool.query("SELECT * FROM customers WHERE id = ?", [customer_id]);
  if (!custRows.length) throw new ApiError(404, "Customer not found.");
  const customer = custRows[0];

  const subtotal = items.reduce((sum, it) => sum + Number(it.price) * Number(it.quantity), 0);
  const total = subtotal; // extend here later for tax/discount if needed

  const conn = await pool.getConnection();
  let invoiceId;
  let invoiceNumber;
  try {
    await conn.beginTransaction();

    // Insert with a placeholder invoice_number, then set the real one from
    // the auto-assigned id so numbers are guaranteed unique & sequential.
    const [result] = await conn.query(
      `INSERT INTO invoices (invoice_number, customer_id, subtotal, total_amount, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [`TEMP-${Date.now()}`, customer_id, subtotal, total, req.user.id]
    );
    invoiceId = result.insertId;
    invoiceNumber = `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${invoiceId}`;
    await conn.query("UPDATE invoices SET invoice_number = ? WHERE id = ?", [invoiceNumber, invoiceId]);

    for (const it of items) {
      const amount = Number(it.price) * Number(it.quantity);
      await conn.query(
        `INSERT INTO invoice_items (invoice_id, product_name, hsn_code, quantity, price, amount)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [invoiceId, it.product_name, it.hsn_code || null, it.quantity, it.price, amount]
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const [invoiceRows] = await pool.query("SELECT * FROM invoices WHERE id = ?", [invoiceId]);
  const invoice = invoiceRows[0];
  const [itemRows] = await pool.query("SELECT * FROM invoice_items WHERE invoice_id = ?", [invoiceId]);
  const company = await getCompanySettings();

  // Generate the branded, downloadable PDF.
  const absPdfPath = await generateInvoicePdf({ invoice, customer, items: itemRows, company });
  const pdfRelPath = relativeUploadPath(absPdfPath);
  await pool.query("UPDATE invoices SET pdf_path = ? WHERE id = ?", [pdfRelPath, invoiceId]);

  // Auto-email it to the customer, if we have their email on file.
  let emailResult = { sent: false, error: "Customer has no email on file." };
  if (customer.email) {
    emailResult = await sendMail({
      to: customer.email,
      subject: `Invoice ${invoiceNumber} from ${company.company_name}`,
      text: `Dear ${customer.name},\n\nPlease find attached your invoice ${invoiceNumber} dated ${new Date(
        invoice.invoice_date
      ).toLocaleString("en-IN")} for a total of ₹${total.toFixed(2)}.\n\nThank you for your business.\n\n${
        company.company_name
      }`,
      attachments: [{ filename: `${invoiceNumber}.pdf`, path: absPdfPath }],
    });
  }
  await pool.query("UPDATE invoices SET email_status = ? WHERE id = ?", [
    emailResult.sent ? "sent" : "failed",
    invoiceId,
  ]);

  const [finalRows] = await pool.query("SELECT * FROM invoices WHERE id = ?", [invoiceId]);
  res.status(201).json({
    success: true,
    invoice: finalRows[0],
    items: itemRows,
    download_url: `${process.env.BASE_URL || ""}${pdfRelPath}`,
    email: emailResult,
  });
});

// GET /api/invoices?customer_id=&from=&to=
const listInvoices = asyncHandler(async (req, res) => {
  const { customer_id, from, to } = req.query;
  let sql = `SELECT i.*, c.name AS customer_name, u.name AS created_by_name
             FROM invoices i JOIN customers c ON c.id = i.customer_id
             JOIN users u ON u.id = i.created_by WHERE 1=1`;
  const params = [];

  if (req.user.role === "user") {
    sql += " AND i.created_by = ?";
    params.push(req.user.id);
  }
  if (customer_id) {
    sql += " AND i.customer_id = ?";
    params.push(customer_id);
  }
  if (from) {
    sql += " AND i.invoice_date >= ?";
    params.push(from);
  }
  if (to) {
    sql += " AND i.invoice_date <= ?";
    params.push(to);
  }
  sql += " ORDER BY i.invoice_date DESC";

  const [rows] = await pool.query(sql, params);
  res.json({ success: true, count: rows.length, invoices: rows });
});

// GET /api/invoices/:id
const getInvoice = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT i.*, c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email
     FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ?`,
    [req.params.id]
  );
  if (!rows.length) throw new ApiError(404, "Invoice not found.");
  const [items] = await pool.query("SELECT * FROM invoice_items WHERE invoice_id = ?", [req.params.id]);
  res.json({ success: true, invoice: rows[0], items });
});

// POST /api/invoices/:id/resend-email
const resendInvoiceEmail = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT i.*, c.name AS customer_name, c.email AS customer_email
     FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ?`,
    [req.params.id]
  );
  if (!rows.length) throw new ApiError(404, "Invoice not found.");
  const invoice = rows[0];
  if (!invoice.pdf_path) throw new ApiError(400, "This invoice has no generated PDF to attach.");
  if (!invoice.customer_email) throw new ApiError(400, "This customer has no email on file.");

  const absPdfPath = path.join(__dirname, "..", invoice.pdf_path.replace(/^\/uploads/, "uploads"));
  const company = await getCompanySettings();

  const emailResult = await sendMail({
    to: invoice.customer_email,
    subject: `Invoice ${invoice.invoice_number} from ${company.company_name}`,
    text: `Dear ${invoice.customer_name},\n\nPlease find attached your invoice ${invoice.invoice_number}.\n\n${company.company_name}`,
    attachments: [{ filename: `${invoice.invoice_number}.pdf`, path: absPdfPath }],
  });

  await pool.query("UPDATE invoices SET email_status = ? WHERE id = ?", [
    emailResult.sent ? "sent" : "failed",
    invoice.id,
  ]);

  res.json({ success: true, email: emailResult });
});

module.exports = { createInvoice, listInvoices, getInvoice, resendInvoiceEmail };
