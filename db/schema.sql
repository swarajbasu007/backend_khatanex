-- FIRST TRACK KHATANEX — Database Schema
-- Run this once against your MySQL server:
--   mysql -u root -p < db/schema.sql

CREATE DATABASE IF NOT EXISTS first_track_khatanex
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE first_track_khatanex;

-- ---------------------------------------------------------------------
-- USERS  (super admin / admin / user all live here — role differentiates)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  name              VARCHAR(100) NOT NULL,
  email             VARCHAR(150) NOT NULL UNIQUE,
  phone             VARCHAR(20),
  password          VARCHAR(255) NOT NULL,
  role              ENUM('user','admin','superadmin') NOT NULL DEFAULT 'user',
  admin_role_type   VARCHAR(50)  DEFAULT NULL,      -- e.g. accountant, manager, stock-keeper
  status            ENUM('active','inactive') NOT NULL DEFAULT 'active',
  promoted_by       INT DEFAULT NULL,               -- super admin who promoted this user
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (promoted_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- CUSTOMERS  (created whenever a "due" sale happens, or manually)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  name         VARCHAR(150) NOT NULL,
  phone        VARCHAR(20),
  email        VARCHAR(150) DEFAULT NULL,   -- used to auto-email invoices
  total_due    DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  created_by   INT NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- COLLECTIONS  (every sale entry: cash / online (UPI) / due)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS collections (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  item_name     VARCHAR(150) DEFAULT NULL,
  amount        DECIMAL(12,2) NOT NULL,
  payment_type  ENUM('cash','online','due') NOT NULL,
  customer_id   INT DEFAULT NULL,          -- required when payment_type = 'due'
  sale_date     DATE NOT NULL DEFAULT (CURRENT_DATE),
  created_by    INT NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- PAYMENTS  (due received from customer / paid out by business / advance from investor)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  payment_category  ENUM('due_received','paid_by_business','advance_from_investor') NOT NULL,
  party_name        VARCHAR(150) NOT NULL,   -- customer / vendor / investor name
  customer_id       INT DEFAULT NULL,        -- linked only for due_received
  purpose           VARCHAR(255) DEFAULT NULL,
  amount            DECIMAL(12,2) NOT NULL,
  payment_mode      ENUM('cash','online') NOT NULL DEFAULT 'cash',
  payment_date      DATE NOT NULL DEFAULT (CURRENT_DATE),
  created_by        INT NOT NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- STOCK
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  product_name  VARCHAR(150) NOT NULL,
  category      VARCHAR(100) DEFAULT NULL,
  type          VARCHAR(100) DEFAULT NULL,
  hsn_code      VARCHAR(20) DEFAULT NULL,
  price         DECIMAL(12,2) NOT NULL,
  quantity      INT NOT NULL DEFAULT 0,
  created_by    INT NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- PURCHASE INVOICES  (records of what a seller billed us for, keyed by
-- HSN code — this is what powers the "auto-fetch price/quantity by HSN
-- code" feature when adding stock: it looks up the latest purchase at
-- that HSN code and pre-fills price & quantity from it)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_invoices (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  seller_name     VARCHAR(150) NOT NULL,
  invoice_number  VARCHAR(50) DEFAULT NULL,
  product_name    VARCHAR(150) NOT NULL,
  hsn_code        VARCHAR(20) NOT NULL,
  quantity        DECIMAL(10,2) NOT NULL,
  price           DECIMAL(12,2) NOT NULL,
  invoice_file    VARCHAR(255) DEFAULT NULL,   -- uploaded copy of the seller's invoice, if any
  invoice_date    DATE NOT NULL DEFAULT (CURRENT_DATE),
  created_by      INT NOT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- COMPANY SETTINGS  (single row: brand name, address, GSTIN, logo — used
-- on generated invoice & waybill PDFs)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS company_settings (
  id            INT PRIMARY KEY DEFAULT 1,
  company_name  VARCHAR(150) NOT NULL DEFAULT 'FIRST TRACK KHATANEX',
  address       VARCHAR(255) DEFAULT NULL,
  gstin         VARCHAR(20) DEFAULT NULL,
  logo_path     VARCHAR(255) DEFAULT NULL,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;
INSERT IGNORE INTO company_settings (id) VALUES (1);

-- ---------------------------------------------------------------------
-- INVOICES  (sales invoices to customers — auto dated, PDF generated,
-- emailed to the customer automatically)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  invoice_number  VARCHAR(30) NOT NULL UNIQUE,
  customer_id     INT NOT NULL,
  invoice_date    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  subtotal        DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_amount    DECIMAL(12,2) NOT NULL DEFAULT 0,
  pdf_path        VARCHAR(255) DEFAULT NULL,
  email_status    ENUM('not_sent','sent','failed') NOT NULL DEFAULT 'not_sent',
  created_by      INT NOT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS invoice_items (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  invoice_id    INT NOT NULL,
  product_name  VARCHAR(150) NOT NULL,
  hsn_code      VARCHAR(20) DEFAULT NULL,
  quantity      DECIMAL(10,2) NOT NULL DEFAULT 1,
  price         DECIMAL(12,2) NOT NULL,
  amount        DECIMAL(12,2) NOT NULL,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- VEHICLE TRIPS / WAY BILLS
--   trip_type = 'outgoing'  -> WE are sending the truck: we generate the
--               waybill ourselves, vehicle/driver + loading photo are
--               mandatory, then start-trip / reached buttons stamp times.
--   trip_type = 'incoming'  -> WE are the buyer: the seller generated the
--               waybill and sent it to us (e.g. over WhatsApp), so we just
--               upload their waybill file + record the same vehicle/driver
--               details.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_trips (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  trip_type             ENUM('outgoing','incoming') NOT NULL,
  vehicle_number        VARCHAR(30) NOT NULL,
  driver_name           VARCHAR(100) NOT NULL,
  driver_phone          VARCHAR(20) NOT NULL,
  from_location         VARCHAR(150) DEFAULT NULL,
  to_location           VARCHAR(150) DEFAULT NULL,
  goods_description     VARCHAR(255) DEFAULT NULL,
  loading_photo         VARCHAR(255) DEFAULT NULL,   -- mandatory for outgoing
  unloading_photo       VARCHAR(255) DEFAULT NULL,   -- always optional
  waybill_number        VARCHAR(50) DEFAULT NULL,    -- auto-generated for outgoing
  waybill_pdf_path      VARCHAR(255) DEFAULT NULL,   -- our own generated waybill (outgoing)
  waybill_uploaded_file VARCHAR(255) DEFAULT NULL,   -- seller's waybill, uploaded (incoming)
  journey_start_time    DATETIME DEFAULT NULL,
  journey_end_time      DATETIME DEFAULT NULL,
  status                ENUM('created','in_transit','completed') NOT NULL DEFAULT 'created',
  created_by            INT NOT NULL,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- EXPENSES  (daily business cash outflow)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expenses (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  description   VARCHAR(255) NOT NULL,
  category      VARCHAR(100) DEFAULT NULL,
  amount        DECIMAL(12,2) NOT NULL,
  expense_date  DATE NOT NULL DEFAULT (CURRENT_DATE),
  created_by    INT NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- Helpful indexes for date-range & sort queries
CREATE INDEX idx_collections_date ON collections(sale_date);
CREATE INDEX idx_collections_creator ON collections(created_by);
CREATE INDEX idx_payments_date ON payments(payment_date);
CREATE INDEX idx_expenses_date ON expenses(expense_date);
CREATE INDEX idx_stock_name ON stock(product_name);
CREATE INDEX idx_stock_hsn ON stock(hsn_code);
CREATE INDEX idx_purchase_invoices_hsn ON purchase_invoices(hsn_code);
CREATE INDEX idx_invoices_customer ON invoices(customer_id);
CREATE INDEX idx_vehicle_trips_type ON vehicle_trips(trip_type);
CREATE INDEX idx_vehicle_trips_vehicle ON vehicle_trips(vehicle_number);
