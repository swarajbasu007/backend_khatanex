const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const { generateWaybillPdf } = require("../utils/generateWaybillPdf");
const { relativeUploadPath } = require("../utils/upload");

const getCompanySettings = async () => {
  const [rows] = await pool.query("SELECT * FROM company_settings WHERE id = 1");
  return (
    rows[0] || {
      company_name: process.env.COMPANY_NAME || "FIRST TRACK KHATANEX",
      address: process.env.COMPANY_ADDRESS || "",
      logo_path: null,
    }
  );
};

// POST /api/vehicles
// multipart/form-data. Common required fields: trip_type, vehicle_number,
// driver_name, driver_phone.
//
// trip_type = 'outgoing' (WE are sending the truck):
//   - file field "loading_photo" is MANDATORY
//   - a way bill is generated automatically (PDF) with a way bill number
//
// trip_type = 'incoming' (WE are the buyer, seller sent us their way bill,
// e.g. over WhatsApp, and we upload a copy here):
//   - file field "waybill_file" is MANDATORY
//   - no way bill is generated — we just store what was uploaded
const createTrip = asyncHandler(async (req, res) => {
  const { trip_type, vehicle_number, driver_name, driver_phone, from_location, to_location, goods_description } =
    req.body;

  if (!["outgoing", "incoming"].includes(trip_type)) {
    throw new ApiError(400, "trip_type must be 'outgoing' or 'incoming'.");
  }
  if (!vehicle_number) throw new ApiError(400, "vehicle_number is required.");
  if (!driver_name) throw new ApiError(400, "driver_name is required.");
  if (!driver_phone) throw new ApiError(400, "driver_phone is required.");

  const loadingPhotoFile = req.files?.loading_photo?.[0];
  const waybillFile = req.files?.waybill_file?.[0];

  if (trip_type === "outgoing" && !loadingPhotoFile) {
    throw new ApiError(400, "loading_photo is required for an outgoing trip (photo after loading).");
  }
  if (trip_type === "incoming" && !waybillFile) {
    throw new ApiError(400, "waybill_file is required for an incoming trip (upload the seller's way bill).");
  }

  const loadingPhotoPath = loadingPhotoFile ? relativeUploadPath(loadingPhotoFile.path) : null;
  const waybillUploadedPath = waybillFile ? relativeUploadPath(waybillFile.path) : null;

  const [result] = await pool.query(
    `INSERT INTO vehicle_trips
       (trip_type, vehicle_number, driver_name, driver_phone, from_location, to_location,
        goods_description, loading_photo, waybill_uploaded_file, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      trip_type,
      vehicle_number,
      driver_name,
      driver_phone,
      from_location || null,
      to_location || null,
      goods_description || null,
      loadingPhotoPath,
      waybillUploadedPath,
      req.user.id,
    ]
  );
  const tripId = result.insertId;

  // For an outgoing trip, auto-generate our own way bill PDF right away.
  if (trip_type === "outgoing") {
    const waybillNumber = `WB-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${tripId}`;
    const company = await getCompanySettings();
    const [tripRows] = await pool.query("SELECT * FROM vehicle_trips WHERE id = ?", [tripId]);
    const absPdfPath = await generateWaybillPdf({ trip: { ...tripRows[0], waybill_number: waybillNumber }, company });
    const pdfRelPath = relativeUploadPath(absPdfPath);
    await pool.query("UPDATE vehicle_trips SET waybill_number = ?, waybill_pdf_path = ? WHERE id = ?", [
      waybillNumber,
      pdfRelPath,
      tripId,
    ]);
  }

  const [finalRows] = await pool.query("SELECT * FROM vehicle_trips WHERE id = ?", [tripId]);
  res.status(201).json({ success: true, trip: finalRows[0] });
});

// PATCH /api/vehicles/:id/start-trip
// Stamps journey_start_time = now. Only valid for outgoing trips that have
// their mandatory loading photo already on file.
const startTrip = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.query("SELECT * FROM vehicle_trips WHERE id = ?", [id]);
  if (!rows.length) throw new ApiError(404, "Trip not found.");
  const trip = rows[0];

  if (trip.trip_type !== "outgoing") throw new ApiError(400, "Only outgoing trips use start-trip.");
  if (!trip.loading_photo) throw new ApiError(400, "Cannot start trip — loading photo is missing.");
  if (trip.journey_start_time) throw new ApiError(400, "Trip has already been started.");

  await pool.query("UPDATE vehicle_trips SET journey_start_time = NOW(), status = 'in_transit' WHERE id = ?", [id]);
  const [updated] = await pool.query("SELECT * FROM vehicle_trips WHERE id = ?", [id]);
  res.json({ success: true, trip: updated[0] });
});

// PATCH /api/vehicles/:id/reached  (multipart/form-data, optional file field "unloading_photo")
// Stamps journey_end_time = now. Unloading photo is optional.
const markReached = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.query("SELECT * FROM vehicle_trips WHERE id = ?", [id]);
  if (!rows.length) throw new ApiError(404, "Trip not found.");
  const trip = rows[0];

  if (trip.trip_type !== "outgoing") throw new ApiError(400, "Only outgoing trips use reached.");
  if (!trip.journey_start_time) throw new ApiError(400, "Trip has not been started yet.");
  if (trip.journey_end_time) throw new ApiError(400, "Trip has already been marked as reached.");

  const unloadingPhotoPath = req.file ? relativeUploadPath(req.file.path) : null;

  await pool.query(
    "UPDATE vehicle_trips SET journey_end_time = NOW(), status = 'completed', unloading_photo = COALESCE(?, unloading_photo) WHERE id = ?",
    [unloadingPhotoPath, id]
  );
  const [updated] = await pool.query("SELECT * FROM vehicle_trips WHERE id = ?", [id]);
  res.json({ success: true, trip: updated[0] });
});

// GET /api/vehicles?trip_type=&status=&vehicle_number=
const listTrips = asyncHandler(async (req, res) => {
  const { trip_type, status, vehicle_number } = req.query;
  let sql = `SELECT v.*, u.name AS added_by FROM vehicle_trips v JOIN users u ON u.id = v.created_by WHERE 1=1`;
  const params = [];

  if (req.user.role === "user") {
    sql += " AND v.created_by = ?";
    params.push(req.user.id);
  }
  if (trip_type) {
    sql += " AND v.trip_type = ?";
    params.push(trip_type);
  }
  if (status) {
    sql += " AND v.status = ?";
    params.push(status);
  }
  if (vehicle_number) {
    sql += " AND v.vehicle_number LIKE ?";
    params.push(`%${vehicle_number}%`);
  }
  sql += " ORDER BY v.created_at DESC";

  const [rows] = await pool.query(sql, params);
  res.json({ success: true, count: rows.length, trips: rows });
});

// GET /api/vehicles/:id
const getTrip = asyncHandler(async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM vehicle_trips WHERE id = ?", [req.params.id]);
  if (!rows.length) throw new ApiError(404, "Trip not found.");
  res.json({ success: true, trip: rows[0] });
});

module.exports = { createTrip, startTrip, markReached, listTrips, getTrip };
