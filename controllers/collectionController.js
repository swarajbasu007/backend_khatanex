const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");

// POST /api/collections
// Add a sale. payment_type: 'cash' | 'online' | 'due'
// If payment_type is 'due', either pass customer_id (existing customer)
// OR customer_name (+ optional customer_phone) to auto-create one,
// and the customer's total_due is increased by the sale amount.
const addCollection = asyncHandler(async (req, res) => {
  const { item_name, amount, payment_type, customer_id, customer_name, customer_phone, sale_date } = req.body;

  if (!amount || Number(amount) <= 0) throw new ApiError(400, "A valid amount is required.");
  if (!["cash", "online", "due"].includes(payment_type)) {
    throw new ApiError(400, "payment_type must be 'cash', 'online' or 'due'.");
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let finalCustomerId = null;

    if (payment_type === "due") {
      if (customer_id) {
        const [existing] = await conn.query("SELECT id FROM customers WHERE id = ?", [customer_id]);
        if (!existing.length) throw new ApiError(404, "Customer not found.");
        finalCustomerId = customer_id;
      } else if (customer_name) {
        const [result] = await conn.query(
          "INSERT INTO customers (name, phone, created_by) VALUES (?, ?, ?)",
          [customer_name, customer_phone || null, req.user.id]
        );
        finalCustomerId = result.insertId;
      } else {
        throw new ApiError(400, "A due sale requires customer_id or customer_name.");
      }

      await conn.query("UPDATE customers SET total_due = total_due + ? WHERE id = ?", [amount, finalCustomerId]);
    }

    const [saleResult] = await conn.query(
      `INSERT INTO collections (item_name, amount, payment_type, customer_id, sale_date, created_by)
       VALUES (?, ?, ?, ?, COALESCE(?, CURRENT_DATE), ?)`,
      [item_name || null, amount, payment_type, finalCustomerId, sale_date || null, req.user.id]
    );

    await conn.commit();

    const [rows] = await pool.query(
      `SELECT c.*, cu.name AS customer_name FROM collections c
       LEFT JOIN customers cu ON cu.id = c.customer_id WHERE c.id = ?`,
      [saleResult.insertId]
    );
    res.status(201).json({ success: true, collection: rows[0] });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// GET /api/collections
// Filters: from, to (dates), payment_type, created_by (admin/superadmin can view any user's entries)
const listCollections = asyncHandler(async (req, res) => {
  const { from, to, payment_type, created_by } = req.query;
  let sql = `SELECT c.*, cu.name AS customer_name, u.name AS added_by
             FROM collections c
             LEFT JOIN customers cu ON cu.id = c.customer_id
             JOIN users u ON u.id = c.created_by WHERE 1=1`;
  const params = [];

  // A plain 'user' can only ever see their own entries.
  if (req.user.role === "user") {
    sql += " AND c.created_by = ?";
    params.push(req.user.id);
  } else if (created_by) {
    sql += " AND c.created_by = ?";
    params.push(created_by);
  }

  if (from) {
    sql += " AND c.sale_date >= ?";
    params.push(from);
  }
  if (to) {
    sql += " AND c.sale_date <= ?";
    params.push(to);
  }
  if (payment_type) {
    sql += " AND c.payment_type = ?";
    params.push(payment_type);
  }

  sql += " ORDER BY c.sale_date DESC, c.created_at DESC";

  const [rows] = await pool.query(sql, params);
  res.json({ success: true, count: rows.length, collections: rows });
});

// Helper: builds "sum cash / sum online / sum due / total" for a date condition
const summarize = async (dateCondition, params, userScope) => {
  let sql = `SELECT
      COALESCE(SUM(CASE WHEN payment_type = 'cash' THEN amount ELSE 0 END), 0)   AS cash_total,
      COALESCE(SUM(CASE WHEN payment_type = 'online' THEN amount ELSE 0 END), 0) AS online_total,
      COALESCE(SUM(CASE WHEN payment_type = 'due' THEN amount ELSE 0 END), 0)    AS due_total,
      COALESCE(SUM(amount), 0) AS grand_total,
      COUNT(*) AS entries
    FROM collections WHERE ${dateCondition}`;
  const finalParams = [...params];
  if (userScope) {
    sql += " AND created_by = ?";
    finalParams.push(userScope);
  }
  const [rows] = await pool.query(sql, finalParams);
  return rows[0];
};

// GET /api/collections/summary
// Returns today / this week / this month totals, each split cash vs online (vs due).
// A plain user only ever sees their own numbers; admin/superadmin can pass
// ?user_id=<id> to see a specific user's numbers, or omit it to see everyone's.
const getSummary = asyncHandler(async (req, res) => {
  const userScope = req.user.role === "user" ? req.user.id : req.query.user_id || null;

  const [today, weekly, monthly] = await Promise.all([
    summarize("sale_date = CURRENT_DATE", [], userScope),
    summarize("sale_date >= (CURRENT_DATE - INTERVAL WEEKDAY(CURRENT_DATE) DAY)", [], userScope),
    summarize("sale_date >= DATE_FORMAT(CURRENT_DATE, '%Y-%m-01')", [], userScope),
  ]);

  res.json({
    success: true,
    scope: userScope ? `user_id=${userScope}` : "all users",
    today,
    this_week: weekly,
    this_month: monthly,
  });
});

module.exports = { addCollection, listCollections, getSummary };
