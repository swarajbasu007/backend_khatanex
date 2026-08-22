const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");

// GET /api/reports/profit-loss?user_id=&from=&to=
// Admin / super admin only (see reportRoutes.js).
//
// Formula (kept simple & transparent so it can be tuned later):
//   income        = SUM(collections.amount)            -> all sales value (cash + online + due)
//   businessPaidOut = SUM(payments WHERE category='paid_by_business')
//   expenses      = SUM(expenses.amount)
//   profit_or_loss = income - businessPaidOut - expenses
//
// advance_from_investor is reported separately (it's financing, not revenue,
// so it is intentionally NOT added into profit).
const getProfitLoss = asyncHandler(async (req, res) => {
  const { user_id, from, to } = req.query;
  if (!user_id) throw new ApiError(400, "user_id is required — pick which user's numbers to calculate.");

  const [userRows] = await pool.query("SELECT id, name, email FROM users WHERE id = ?", [user_id]);
  if (!userRows.length) throw new ApiError(404, "User not found.");

  const dateFilter = (col) => {
    const clauses = [];
    const params = [];
    if (from) {
      clauses.push(`${col} >= ?`);
      params.push(from);
    }
    if (to) {
      clauses.push(`${col} <= ?`);
      params.push(to);
    }
    return { clause: clauses.length ? "AND " + clauses.join(" AND ") : "", params };
  };

  const salesFilter = dateFilter("sale_date");
  const [[income]] = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN payment_type='cash' THEN amount ELSE 0 END),0) AS cash,
       COALESCE(SUM(CASE WHEN payment_type='online' THEN amount ELSE 0 END),0) AS online,
       COALESCE(SUM(CASE WHEN payment_type='due' THEN amount ELSE 0 END),0) AS due,
       COALESCE(SUM(amount),0) AS total
     FROM collections WHERE created_by = ? ${salesFilter.clause}`,
    [user_id, ...salesFilter.params]
  );

  const expFilter = dateFilter("expense_date");
  const [[expenses]] = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE created_by = ? ${expFilter.clause}`,
    [user_id, ...expFilter.params]
  );

  const payFilter = dateFilter("payment_date");
  const [[paidByBusiness]] = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total FROM payments
     WHERE created_by = ? AND payment_category = 'paid_by_business' ${payFilter.clause}`,
    [user_id, ...payFilter.params]
  );
  const [[advanceFromInvestor]] = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total FROM payments
     WHERE created_by = ? AND payment_category = 'advance_from_investor' ${payFilter.clause}`,
    [user_id, ...payFilter.params]
  );
  const [[dueReceived]] = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total FROM payments
     WHERE created_by = ? AND payment_category = 'due_received' ${payFilter.clause}`,
    [user_id, ...payFilter.params]
  );

  const profitOrLoss = Number(income.total) - Number(paidByBusiness.total) - Number(expenses.total);

  res.json({
    success: true,
    user: userRows[0],
    range: { from: from || "all-time", to: to || "all-time" },
    income_from_sales: income,
    expenses_total: expenses.total,
    paid_out_by_business: paidByBusiness.total,
    due_received_from_customers: dueReceived.total,
    advance_from_investor: advanceFromInvestor.total,
    profit_or_loss: profitOrLoss,
    note: "profit_or_loss = total sales - amount paid out by business - expenses. Investor advances and due collections are financing/cashflow items, shown separately and not counted as profit.",
  });
});

module.exports = { getProfitLoss };
