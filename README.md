# FIRST TRACK KHATANEX — Backend

Node.js + Express + MySQL backend for a digital ledger / business accounting app.

## 1. Setup

```bash
npm install
cp .env.example .env      # then fill in your real DB password, JWT secret, etc.
mysql -u root -p < db/schema.sql
npm run seed:superadmin   # creates the ONE super admin, from SUPERADMIN_* in .env
npm run dev                # or: npm start
```

Server runs on `http://localhost:5000` by default. All endpoints are prefixed `/api`.

## 2. Roles & how promotion works

- **user** — anyone who registers via `POST /api/auth/register`. Can use their own
  collections, customers, stock, expenses, payments.
- **admin** — a user promoted by the super admin, with an `admin_role_type`
  label (e.g. `accountant`, `manager`, `stock-keeper`) you choose freely per user.
  Admin/superadmin can see **all** users' data, not just their own.
- **superadmin** — exactly one account, created only via `npm run seed:superadmin`
  (never through a public route). Logs in with the normal `/api/auth/login` route
  once seeded, just like anyone else — the role stored in the DB is what grants power.

Flow requested: a user registers/logs in normally → super admin looks them up by id
(`GET /api/superadmin/users`) → promotes them (`PATCH /api/superadmin/users/:id/promote`).
The next request that user makes with their existing JWT is automatically treated as
an admin, because `authenticate` re-reads the role from the DB on every request.

## 3. Auth

All protected routes need: `Authorization: Bearer <token>` (token returned by
register/login).

| Method | Route | Who | Purpose |
|---|---|---|---|
| POST | /api/auth/register | public | create a normal user |
| POST | /api/auth/login | public | login, get JWT |
| GET | /api/auth/me | any logged-in | current profile |

## 4. Super admin

| Method | Route | Purpose |
|---|---|---|
| GET | /api/superadmin/users | list every account (find ids here) |
| GET | /api/superadmin/users/:id | one account's detail |
| PATCH | /api/superadmin/users/:id/promote | body `{ admin_role_type }` → makes them admin |
| PATCH | /api/superadmin/users/:id/demote | back to plain user |
| PATCH | /api/superadmin/users/:id/status | body `{ status: "active"\|"inactive" }` |

## 5. Customers

| Method | Route | Purpose |
|---|---|---|
| POST | /api/customers | `{ name, phone }` |
| GET | /api/customers?search= | list, sorted by highest due first |
| GET | /api/customers/:id | profile: due amount + full sale/payment history |
| PATCH | /api/customers/:id | edit name/phone |

## 6. Collections (add-sale feature)

| Method | Route | Purpose |
|---|---|---|
| POST | /api/collections | add a sale, see body shape below |
| GET | /api/collections?from=&to=&payment_type= | list (filters optional) |
| GET | /api/collections/summary?user_id= | today / this_week / this_month, each split cash vs online vs due |

Body for `POST /api/collections`:
```json
{
  "item_name": "2 packets of rice",      // optional
  "amount": 500,
  "payment_type": "due",                  // "cash" | "online" | "due"
  "customer_id": 3,                       // OR customer_name below, only needed if payment_type = "due"
  "customer_name": "Ramesh",
  "customer_phone": "9800000000",
  "sale_date": "2026-08-17"               // optional, defaults to today
}
```
When `payment_type` is `"due"`, the customer's `total_due` is increased automatically.

## 7. Payments (dues paid / paid by business / investor advance)

| Method | Route | Purpose |
|---|---|---|
| POST | /api/payments | see `payment_category` below |
| GET | /api/payments?category= | list, filter by category |

`payment_category`:
- `due_received` — a customer clears part/all of their due. Requires `customer_id`; reduces their `total_due`.
- `paid_by_business` — money the business paid out (vendor, rent, staff, etc).
- `advance_from_investor` — money brought in as investor advance/capital.

Body example:
```json
{
  "payment_category": "due_received",
  "party_name": "Ramesh",
  "customer_id": 3,
  "purpose": "cleared last week's due",
  "amount": 200,
  "payment_mode": "cash"
}
```

## 8. Stock / Inventory (with HSN auto-fill)

| Method | Route | Purpose |
|---|---|---|
| POST | /api/stock | `{ product_name, category, type, hsn_code, price, quantity }` |
| GET | /api/stock?sortBy=name\|type\|price\|category&order=asc\|desc&search= | list, sortable |
| PATCH | /api/stock/:id | edit |
| DELETE | /api/stock/:id | remove |

**How HSN auto-fill actually works** (important — read this): an HSN code is a shared
tax-classification code, not a unique price lookup — there's no public database that maps
an HSN code to *your* price. So the automation here is: you record each purchase invoice
your seller gives you (`POST /api/purchase-invoices`, see below) with its HSN code, price,
and quantity. From then on, if you `POST /api/stock` with just a `hsn_code` and leave
`price`/`quantity` blank, the server auto-fills them from **your own latest purchase
invoice** at that HSN code. You can also call `GET /api/purchase-invoices/lookup?hsn_code=`
directly from the frontend to preview the match before submitting the form (e.g. to fill
the input boxes live as the user types the HSN code).

### Purchase invoices (seller invoices, keyed by HSN code)

| Method | Route | Purpose |
|---|---|---|
| POST | /api/purchase-invoices | multipart form: `seller_name, invoice_number, product_name, hsn_code, quantity, price, invoice_date` + optional file `invoice_file` |
| GET | /api/purchase-invoices?hsn_code=&seller_name= | list recorded purchase invoices |
| GET | /api/purchase-invoices/lookup?hsn_code= | latest match for a given HSN code (used for autofill) |

## 9. Expenses (cash outflow)

| Method | Route | Purpose |
|---|---|---|
| POST | /api/expenses | `{ description, category, amount, expense_date }` |
| GET | /api/expenses?from=&to=&category= | list |
| GET | /api/expenses/summary?user_id= | daily/weekly/monthly totals |

## 10. Reports — profit & loss (admin/superadmin only)

| Method | Route | Purpose |
|---|---|---|
| GET | /api/reports/profit-loss?user_id=&from=&to= | profit/loss breakdown for one user |

Formula used (see `controllers/reportController.js` to tune):
```
profit_or_loss = total sales (cash+online+due) - amount paid out by business - expenses
```
`advance_from_investor` and `due_received` are reported separately since they're
financing/cashflow, not revenue. Easy to remove this whole module later if not
needed — it's fully isolated in `reportController.js` / `reportRoutes.js`.

## 11. Invoices (auto-dated, branded PDF, auto-emailed)

| Method | Route | Purpose |
|---|---|---|
| POST | /api/invoices | `{ customer_id, items: [{ product_name, hsn_code, quantity, price }] }` |
| GET | /api/invoices?customer_id=&from=&to= | list |
| GET | /api/invoices/:id | one invoice + its line items |
| POST | /api/invoices/:id/resend-email | re-attempt emailing the same PDF |

What happens on `POST /api/invoices`:
1. `invoice_date` is always set to the current server time — never taken from the request.
2. A unique `invoice_number` is generated (`INV-YYYYMMDD-<id>`).
3. A PDF is generated with your brand logo/name/address (from `company_settings`,
   see Settings below) and an itemized table, saved under `/uploads/invoices/`, and
   a direct download URL is returned in the response (`download_url`).
4. If the customer has an `email` on file, the PDF is automatically emailed to them
   via the SMTP settings in `.env`. `invoices.email_status` records `sent`/`failed`/`not_sent`
   so you can see at a glance which invoices actually went out, and retry failed ones with
   the resend-email route.

**You must add SMTP credentials to `.env` for auto-emailing to actually send** (see
`.env.example` — works with a Gmail address + an "app password", or any SMTP provider).
Without SMTP configured, invoices are still created and the PDF is still generated and
downloadable — only the auto-email step is skipped, with `email_status: "failed"` and a
clear reason in the response.

## 12. Settings (brand logo, company name/address/GSTIN — used on all PDFs)

| Method | Route | Purpose |
|---|---|---|
| GET | /api/settings | current company info + logo path |
| PATCH | /api/settings | admin/superadmin — `{ company_name, address, gstin }` |
| POST | /api/settings/logo | admin/superadmin — multipart file field `logo` |

Upload your logo once via `POST /api/settings/logo`; every invoice and way bill PDF
generated afterward will include it automatically.

## 13. Vehicles / Way Bills

Two flows, one endpoint (`trip_type` decides which):

**`outgoing`** — you're sending a truck: you generate the way bill yourself.
**`incoming`** — you're the buyer: the seller already generated a way bill and sent
it to you (e.g. over WhatsApp); you just upload their copy here.

| Method | Route | Purpose |
|---|---|---|
| POST | /api/vehicles | create a trip — see field requirements below |
| GET | /api/vehicles?trip_type=&status=&vehicle_number= | list |
| GET | /api/vehicles/:id | one trip's full detail |
| PATCH | /api/vehicles/:id/start-trip | outgoing only — stamps journey start time = now |
| PATCH | /api/vehicles/:id/reached | outgoing only — stamps journey end time = now, optional `unloading_photo` file |

`POST /api/vehicles` is `multipart/form-data`. Always required: `trip_type`
(`outgoing`/`incoming`), `vehicle_number`, `driver_name`, `driver_phone`.

- If `trip_type = outgoing`: file field **`loading_photo` is mandatory**
  (photo after loading). A way bill number + downloadable PDF are generated
  automatically and returned as `waybill_number` / `waybill_pdf_path`. You can
  then call `start-trip` once loaded and on the road, and `reached` once the
  driver confirms arrival — each stamps the real server time, and `reached`
  optionally accepts an `unloading_photo` file (not mandatory).
- If `trip_type = incoming`: file field **`waybill_file` is mandatory**
  (upload the copy the seller sent you) — stored as `waybill_uploaded_file`.
  No PDF is generated on your side since it's the seller's document.

Optional fields either way: `from_location`, `to_location`, `goods_description`.

## 14. Notes for the frontend integration

- All list endpoints return `{ success, count, <resource>: [...] }`.
- All single-item endpoints return `{ success, <resource>: {...} }`.
- Errors return `{ success: false, message }` with an appropriate HTTP status.
- A plain `user` role only ever sees/affects their **own** collections, expenses,
  and payments; `admin`/`superadmin` can see everyone's (pass `?user_id=` /
  `?created_by=` where supported, or omit it to see all).
