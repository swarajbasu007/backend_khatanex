const router = require("express").Router();
const { getProfitLoss } = require("../controllers/reportController");
const { authenticate, authorize } = require("../middleware/auth");

// Admin & super admin only. If you want to restrict this further to just
// an 'accountant' admin type, swap authorize("admin","superadmin") for:
//   authorizeAdminRoleType("accountant")
// (import it from ../middleware/auth)
router.use(authenticate, authorize("admin", "superadmin"));

router.get("/profit-loss", getProfitLoss);

module.exports = router;
