const router = require("express").Router();
const { addPayment, listPayments } = require("../controllers/paymentController");
const { authenticate, authorize } = require("../middleware/auth");

router.use(authenticate, authorize("user", "admin", "superadmin"));

router.post("/", addPayment);
router.get("/", listPayments);

module.exports = router;
