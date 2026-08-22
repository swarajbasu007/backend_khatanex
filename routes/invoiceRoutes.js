const router = require("express").Router();
const { createInvoice, listInvoices, getInvoice, resendInvoiceEmail } = require("../controllers/invoiceController");
const { authenticate, authorize } = require("../middleware/auth");

router.use(authenticate, authorize("user", "admin", "superadmin"));

router.post("/", createInvoice);
router.get("/", listInvoices);
router.get("/:id", getInvoice);
router.post("/:id/resend-email", resendInvoiceEmail);

module.exports = router;
