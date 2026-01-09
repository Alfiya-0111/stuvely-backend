// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import admin from "firebase-admin";
import fs from "fs";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ------------------------------
// ENV
// ------------------------------
const PORT = process.env.PORT || 5001;
const MODE = process.env.MODE || "test"; // test | live

const SHIPROCKET_EMAIL = process.env.SHIPROCKET_EMAIL;
const SHIPROCKET_PASSWORD = process.env.SHIPROCKET_PASSWORD;
const SHIPROCKET_PICKUP = process.env.SHIPROCKET_PICKUP || "Primary";
const SHIPROCKET_BASE = "https://apiv2.shiprocket.in/v1/external";

// ------------------------------
// Firebase Admin Init
// ------------------------------
let serviceAccount;

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    console.log("✅ Firebase service account loaded from ENV");
  } else {
    serviceAccount = JSON.parse(fs.readFileSync("./serviceAccountKey.json", "utf8"));
    console.log("✅ Firebase service account loaded from file");
  }
} catch (err) {
  console.error("❌ Firebase service account error:", err.message);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DB_URL || `https://${serviceAccount.project_id}.firebaseio.com`,
});

const db = admin.database();

// ------------------------------
// Shiprocket Token Manager
// ------------------------------
let SHIPROCKET_TOKEN = null;
let TOKEN_EXPIRE_TIME = 0;

async function getShiprocketToken() {
  const now = Date.now();

  if (MODE === "test") {
    console.log("🟡 TEST MODE → Shiprocket skipped");
    return "dummy-token";
  }

  if (SHIPROCKET_TOKEN && now < TOKEN_EXPIRE_TIME) return SHIPROCKET_TOKEN;

  try {
    const resp = await axios.post(
      `${SHIPROCKET_BASE}/auth/login`,
      { email: SHIPROCKET_EMAIL, password: SHIPROCKET_PASSWORD },
      { timeout: 15000 }
    );

    SHIPROCKET_TOKEN = resp.data.token;
    TOKEN_EXPIRE_TIME = now + 23 * 60 * 60 * 1000; // 23 hours
    console.log("✅ Shiprocket token generated");
    return SHIPROCKET_TOKEN;
  } catch (err) {
    console.error("❌ Shiprocket auth error:", err.response?.data || err.message);
    throw new Error("Shiprocket authentication failed");
  }
}

// ------------------------------
// Dummy AWB Generator
// ------------------------------
function generateDummyAWB() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(100000 + Math.random() * 900000);
  return `AWB-${MODE.toUpperCase()}-${date}-${rand}`;
}

// ------------------------------
// Helper → Order Items
// ------------------------------
function buildOrderItems(items = [], defaults = {}) {
  return items.map((it, i) => ({
    name: String(it.name || `Item ${i + 1}`),
    sku: String(it.sku || `SKU-${i + 1}`),
    units: Number(it.units || it.qty || 1),
    selling_price: Number(it.selling_price || it.price || defaults.price || 0),
  }));
}

// ------------------------------
// CREATE SHIPMENT
// ------------------------------
app.post("/create-shipment", async (req, res) => {
  try {
    const order = req.body;

    if (
      !order?.orderId ||
      !order?.customer_name ||
      !order?.address ||
      !order?.city ||
      !order?.pincode ||
      !order?.userId ||
      !Array.isArray(order.items) ||
      order.items.length === 0
    ) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    const orderItems = buildOrderItems(order.items, { price: order.price });
    const sub_total = orderItems.reduce((sum, i) => sum + i.selling_price * i.units, 0);

    let shiprocketResp = { data: {} };

    if (MODE === "live") {
      const token = await getShiprocketToken();

      shiprocketResp = await axios.post(
        `${SHIPROCKET_BASE}/orders/create/adhoc`,
        {
          order_id: String(order.orderId),
          order_date: new Date().toISOString(),
          pickup_location: SHIPROCKET_PICKUP,

          billing_customer_name: order.customer_name.split(" ")[0],
          billing_last_name: order.customer_name.split(" ").slice(1).join(" ") || "",
          billing_address: order.address,
          billing_city: order.city,
          billing_pincode: String(order.pincode),
          billing_state: order.state || "",
          billing_country: "India",
          billing_email: order.email || "demo@mail.com",
          billing_phone: String(order.phone || "9999999999"),

          shipping_is_billing: true,
          payment_method: order.payment_method || "Prepaid",
          sub_total,
          order_items: orderItems,
          length: order.length || 10,
          breadth: order.breadth || 10,
          height: order.height || 10,
          weight: order.weight || 0.5,
        },
        {
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          timeout: 30000,
        }
      );
    }

    const awb = shiprocketResp.data?.awb_code || shiprocketResp.data?.response?.data?.awb_code || generateDummyAWB();

    await db.ref(`orders/${order.userId}/${order.orderId}`).update({
      awb,
      shipmentMode: MODE,
      shipmentId: shiprocketResp.data?.shipment_id || null,
      shipmentOrderId: shiprocketResp.data?.order_id || null,
      shippedAt: new Date().toISOString(),
    });

    return res.json({ success: true, mode: MODE, awb, shipment_id: shiprocketResp.data?.shipment_id || "test-shipment" });
  } catch (err) {
    console.error("❌ CREATE SHIPMENT ERROR:", err.response?.data || err.message);
    return res.status(500).json({ success: false, message: "Shipment creation failed", error: err.response?.data || err.message });
  }
});

// ------------------------------
// TRACK SHIPMENT
// ------------------------------
app.get("/track/:awb", async (req, res) => {
  try {
    const { awb } = req.params;

    if (!awb) return res.status(400).json({ success: false, message: "Missing AWB" });

    if (MODE === "test") {
      return res.json({ success: true, data: { awb, status: "In Transit", note: "TEST MODE" } });
    }

    const token = await getShiprocketToken();
    const r = await axios.get(`${SHIPROCKET_BASE}/courier/track/awb/${awb}`, { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 });

    res.json({ success: true, data: r.data });
  } catch (err) {
    console.error("❌ TRACK ERROR:", err.response?.data || err.message);
    return res.status(500).json({ success: false, message: "Tracking failed", error: err.response?.data || err.message });
  }
});

// ------------------------------
// USER REQUEST CANCEL
// ------------------------------
app.post("/request-cancel", async (req, res) => {
  try {
    const { userId, orderId, reason } = req.body;
    if (!userId || !orderId) return res.status(400).json({ success: false, message: "Missing fields" });

    await db.ref(`cancelRequests/${userId}/${orderId}`).set({
      orderId,
      reason,
      requestedAt: new Date().toISOString(),
      status: "Pending",
    });

    await db.ref(`orders/${userId}/${orderId}`).update({ cancelRequested: true, status: "Pending Cancel" });

    return res.json({ success: true, message: "Cancel request submitted" });
  } catch (err) {
    console.error("❌ REQUEST CANCEL ERROR:", err);
    return res.status(500).json({ success: false, message: "Failed", error: err.message });
  }
});

// ------------------------------
// ADMIN APPROVE CANCEL
// ------------------------------
app.post("/admin/approve-cancel", async (req, res) => {
  try {
    const { userId, orderId } = req.body;
    if (!userId || !orderId) return res.status(400).json({ success: false, message: "Missing user/order" });

    const orderRef = db.ref(`orders/${userId}/${orderId}`);
    const orderSnap = await orderRef.once("value");
    if (!orderSnap.exists()) return res.status(404).json({ success: false, message: "Order not found" });

    const order = orderSnap.val();

    if (MODE === "live" && (order.shipmentOrderId || order.shipmentId)) {
      try {
        const token = await getShiprocketToken();
        const ids = [];
        if (order.shipmentOrderId) ids.push(order.shipmentOrderId);
        if (order.shipmentId) ids.push(order.shipmentId);
        if (ids.length > 0) await axios.post(`${SHIPROCKET_BASE}/orders/cancel`, { ids }, { headers: { Authorization: `Bearer ${token}` } });
      } catch (e) {
        console.warn("⚠️ Shiprocket cancel warning:", e.response?.data || e.message);
      }
    }

    await orderRef.update({ status: "Cancelled", cancelReason: "Approved by admin", cancelledAt: new Date().toISOString(), cancelledByAdmin: true });

    return res.json({ success: true, message: "Order cancelled" });
  } catch (err) {
    console.error("❌ APPROVE CANCEL ERROR:", err);
    return res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// ------------------------------
// HEALTH CHECK
// ------------------------------
app.get("/", (req, res) => res.json({ ok: true, mode: MODE, time: new Date().toISOString() }));

// ------------------------------
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT} | MODE: ${MODE}`));
