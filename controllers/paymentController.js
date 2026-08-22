const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");

const CATEGORIES = ["due_received", "paid_by_business", "advance_from_investor"];

// POST /api/payments
// payment_category:
//   'due_received'          -> a customer clears (part of) their due. Requires customer_id.
//   'paid_by_business'      -> money paid OUT by the business to someone (vendor, staff, etc).
//   'advance_from_investor' -> money brought IN by an investor as advance/capital.
const addPayment = asyncHandler(async (req, res) => {
  const { payment_category, party_name, customer_id, purpose, amount, payment_mode, payment_date } = req.body;

  if (!CATEGORIES.includes(payment_category)) {
    throw new ApiError(400, `payment_category must be one of: ${CATEGORIES.join(", ")}`);
  }
  if (!party_name) throw new ApiError(400, "party_name is required.");
  if (!amount || Number(amount) <= 0) throw new ApiError(400, "A valid amount is required.");

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (payment_category === "due_received") {
      if (!customer_id) throw new ApiError(400, "customer_id is required for due_received.");
      const [rows] = await conn.query("SELECT total_due FROM customers WHERE id = ?", [customer_id]);
      if (!rows.length) throw new ApiError(404, "Customer not found.");
      if (Number(amount) > Number(rows[0].total_due)) {
        throw new ApiError(400, `Amount exceeds customer's outstanding due (₹${rows[0].total_due}).`);
      }
      await conn.query("UPDATE customers SET total_due = total_due - ? WHERE id = ?", [amount, customer_id]);
    }

    const [result] = await conn.query(
      `INSERT INTO payments (payment_category, party_name, customer_id, purpose, amount, payment_mode, payment_date, created_by)
       VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_DATE), ?)`,
      [
        payment_category,
        party_name,
        payment_category === "due_received" ? customer_id : null,
        purpose || null,
        amount,
        payment_mode || "cash",
        payment_date || null,
        req.user.id,
      ]
    );

    await conn.commit();
    const [rows] = await pool.query("SELECT * FROM payments WHERE id = ?", [result.insertId]);
    res.status(201).json({ success: true, payment: rows[0] });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// GET /api/payments?category=due_received|paid_by_business|advance_from_investor
const listPayments = asyncHandler(async (req, res) => {
  const { category, from, to } = req.query;
  let sql = `SELECT p.*, u.name AS added_by, cu.name AS customer_name
             FROM payments p JOIN users u ON u.id = p.created_by
             LEFT JOIN customers cu ON cu.id = p.customer_id WHERE 1=1`;
  const params = [];

  if (req.user.role === "user") {
    sql += " AND p.created_by = ?";
    params.push(req.user.id);
  }
  if (category) {
    if (!CATEGORIES.includes(category)) throw new ApiError(400, "Invalid category filter.");
    sql += " AND p.payment_category = ?";
    params.push(category);
  }
  if (from) {
    sql += " AND p.payment_date >= ?";
    params.push(from);
  }
  if (to) {
    sql += " AND p.payment_date <= ?";
    params.push(to);
  }

  sql += " ORDER BY p.payment_date DESC, p.created_at DESC";
  const [rows] = await pool.query(sql, params);
  res.json({ success: true, count: rows.length, payments: rows });
});

module.exports = { addPayment, listPayments };
