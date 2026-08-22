const router = require("express").Router();
const {
  listUsers,
  getUser,
  promoteToAdmin,
  demoteToUser,
  setUserStatus,
} = require("../controllers/superAdminController");
const { authenticate, authorize } = require("../middleware/auth");

// Every route here is super-admin-only.
router.use(authenticate, authorize("superadmin"));

router.get("/users", listUsers);
router.get("/users/:id", getUser);
router.patch("/users/:id/promote", promoteToAdmin);
router.patch("/users/:id/demote", demoteToUser);
router.patch("/users/:id/status", setUserStatus);

module.exports = router;
