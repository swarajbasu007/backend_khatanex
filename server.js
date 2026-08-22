require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const { notFound, errorHandler } = require("./middleware/errorHandler");

const authRoutes = require("./routes/authRoutes");
const superAdminRoutes = require("./routes/superAdminRoutes");
const customerRoutes = require("./routes/customerRoutes");
const collectionRoutes = require("./routes/collectionRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const stockRoutes = require("./routes/stockRoutes");
const expenseRoutes = require("./routes/expenseRoutes");
const reportRoutes = require("./routes/reportRoutes");
const purchaseInvoiceRoutes = require("./routes/purchaseInvoiceRoutes");
const invoiceRoutes = require("./routes/invoiceRoutes");
const vehicleRoutes = require("./routes/vehicleRoutes");
const settingsRoutes = require("./routes/settingsRoutes");

const app = express();

app.use(helmet({ crossOriginResourcePolicy: false })); // allow serving /uploads images/PDFs cross-origin to the frontend
app.use(cors());
app.use(express.json());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// Serves everything under /uploads (logos, loading/unloading photos,
// generated invoice & waybill PDFs, uploaded waybills/purchase invoices)
// as static files — e.g. http://localhost:5000/uploads/invoices/INV-....pdf
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/", (req, res) => {
  res.json({ success: true, message: "FIRST TRACK KHATANEX API is running." });
});
app.get("/api/health", (req, res) => res.json({ success: true, status: "ok" }));

app.use("/api/auth", authRoutes);
app.use("/api/superadmin", superAdminRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/collections", collectionRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/stock", stockRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/purchase-invoices", purchaseInvoiceRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/vehicles", vehicleRoutes);
app.use("/api/settings", settingsRoutes);

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 FIRST TRACK KHATANEX API running on port ${PORT}`));
