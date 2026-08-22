const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");

// GET /api/superadmin/users
// Super admin gets a full overview of every account — this is how they
// find the id of a user they want to promote (per the requirement:
// "if he can get any id [of a] user he can set him/her admin").
const listUsers = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, name, email, phone, role, admin_role_type, status, created_at
     FROM users ORDER BY created_at DESC`
  );
  res.json({ success: true, count: rows.length, users: rows });
});

// GET /api/superadmin/users/:id
const getUser = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, name, email, phone, role, admin_role_type, status, created_at
     FROM users WHERE id = ?`,
    [req.params.id]
  );
  if (!rows.length) throw new ApiError(404, "User not found.");
  res.json({ success: true, user: rows[0] });
});

// PATCH /api/superadmin/users/:id/promote
// body: { admin_role_type: "accountant" | "manager" | ... }
const promoteToAdmin = asyncHandler(async (req, res) => {
  const { admin_role_type } = req.body;
  const { id } = req.params;

  if (!admin_role_type) throw new ApiError(400, "admin_role_type is required (e.g. 'accountant').");
  if (Number(id) === req.user.id) throw new ApiError(400, "You cannot change your own role.");

  const [rows] = await pool.query("SELECT * FROM users WHERE id = ?", [id]);
  if (!rows.length) throw new ApiError(404, "User not found.");
  if (rows[0].role === "superadmin") throw new ApiError(400, "Cannot change the super admin's role.");

  await pool.query(
    "UPDATE users SET role = 'admin', admin_role_type = ?, promoted_by = ? WHERE id = ?",
    [admin_role_type, req.user.id, id]
  );

  const [updated] = await pool.query(
    "SELECT id, name, email, role, admin_role_type, status FROM users WHERE id = ?",
    [id]
  );
  res.json({ success: true, message: `User promoted to admin (${admin_role_type}).`, user: updated[0] });
});

// PATCH /api/superadmin/users/:id/demote
// Reverts an admin back to a plain user.
const demoteToUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (Number(id) === req.user.id) throw new ApiError(400, "You cannot change your own role.");

  const [rows] = await pool.query("SELECT * FROM users WHERE id = ?", [id]);
  if (!rows.length) throw new ApiError(404, "User not found.");
  if (rows[0].role === "superadmin") throw new ApiError(400, "Cannot change the super admin's role.");

  await pool.query(
    "UPDATE users SET role = 'user', admin_role_type = NULL, promoted_by = NULL WHERE id = ?",
    [id]
  );
  res.json({ success: true, message: "User demoted back to a normal user." });
});

// PATCH /api/superadmin/users/:id/status
// body: { status: "active" | "inactive" }
const setUserStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const { id } = req.params;
  if (!["active", "inactive"].includes(status)) {
    throw new ApiError(400, "status must be 'active' or 'inactive'.");
  }
  if (Number(id) === req.user.id) throw new ApiError(400, "You cannot deactivate your own account.");

  const [result] = await pool.query("UPDATE users SET status = ? WHERE id = ?", [status, id]);
  if (!result.affectedRows) throw new ApiError(404, "User not found.");

  res.json({ success: true, message: `User status set to ${status}.` });
});

module.exports = { listUsers, getUser, promoteToAdmin, demoteToUser, setUserStatus };
