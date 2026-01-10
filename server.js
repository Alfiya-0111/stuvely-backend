

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import admin from "firebase-admin";



dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ------------------------------
// ENV
// ------------------------------
const PORT = process.env.PORT || 5001;
const SHIPROCKET_EMAIL = process.env.SHIPROCKET_EMAIL;
const SHIPROCKET_PASSWORD = process.env.SHIPROCKET_PASSWORD;
const SHIPROCKET_PICKUP = process.env.SHIPROCKET_PICKUP || "Primary";
const SHIPROCKET_BASE = "https://apiv2.shiprocket.in/v1/external";
const MODE = process.env.MODE || "test"; // "test" | "live"

// ------------------------------
// Firebase Admin init
// ------------------------------
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY
  ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
  : undefined,
    }),
    databaseURL: process.env.FIREBASE_DB_URL,
  });
}

console.log("🔥 Firebase Admin initialized");


console.log("🔥 Firebase Admin initialized");


const db = admin.database();


// ------------------------------
// Shiprocket token manager
// ------------------------------
let SHIPROCKET_TOKEN = null;
let TOKEN_EXPIRE_TIME = 0;

async function getShiprocketToken() {
  const now = Date.now();

  if (MODE === "test") {
    console.log("🟡 TEST MODE: Shiprocket token skipped.");
    return "dummy-token";
  }

  if (SHIPROCKET_TOKEN && now < TOKEN_EXPIRE_TIME) {
    return SHIPROCKET_TOKEN;
  }

  try {
    const resp = await axios.post(
      `${SHIPROCKET_BASE}/auth/login`,
      {
        email: SHIPROCKET_EMAIL,
        password: SHIPROCKET_PASSWORD,
      },
      { timeout: 15000 }
    );

    SHIPROCKET_TOKEN = resp.data.token;
    TOKEN_EXPIRE_TIME = now + 23 * 60 * 60 * 1000;

    console.log("✅ Shiprocket token fetched");
    return SHIPROCKET_TOKEN;
  } catch (err) {
    console.error(
      "Shiprocket Auth Error:",
      err.response?.data || err.message
    );
    throw new Error("Shiprocket auth failed");
  }
}

// -------------------------------------------------------
// Dummy AWB Generator
// -------------------------------------------------------
function generateDummyAWB() {
  const prefix = "AWB-DEL";
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}-${date}-${random}`;
}

// -------------------------------------------------------
// Helper → Build Shiprocket order_items fields
// -------------------------------------------------------
function buildOrderItems(items = [], orderDefaults = {}) {
  return items.map((it, idx) => {
    const units =
      Number(it?.units ?? it?.quantity ?? it?.qty ?? 1) || 1;

    const selling_price =
      Number(
        it?.selling_price ??
          it?.sellingPrice ??
          it?.currentPrice ??
          it?.price ??
          orderDefaults.price ??
          0
      ) || 0;

    return {
      name: String(it?.name ?? `Item ${idx + 1}`),
      sku: String(it?.sku ?? `SKU-${idx + 1}`),
      units,
      selling_price,
    };
  });
}

// -------------------------------------------------------
// CREATE SHIPMENT
// -------------------------------------------------------
app.post("/create-shipment", async (req, res) => {
  try {
    const order = req.body || {};

    if (
      !order.orderId ||
      !order.customer_name ||
      !order.address ||
      !order.city ||
      !order.pincode ||
      !order.userId ||
      !Array.isArray(order.items) ||
      order.items.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing fields",
      });
    }

    const token = await getShiprocketToken();
    const orderItems = buildOrderItems(order.items, {
      price: order.price,
    });

    const sub_total = orderItems.reduce(
      (sum, it) =>
        sum +
        Number(it.selling_price || 0) *
          Number(it.units || 1),
      0
    );

    let r = { data: {} };

    // REAL SHIPROCKET CALL
    if (MODE === "live") {
      r = await axios.post(
        `${SHIPROCKET_BASE}/orders/create/adhoc`,
        {
          order_id: String(order.orderId),
          order_date: new Date().toISOString(),
          pickup_location: SHIPROCKET_PICKUP,

          billing_customer_name:
            order.customer_name.split(" ")[0] || "Customer",
          billing_last_name:
            order.customer_name.split(" ").slice(1).join(" ") ||
            "",
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
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          timeout: 30000,
        }
      );
    }

    // ---------------------------
    // AWB NUMBER HANDLING
    // ---------------------------
    let awbNumber = null;

    if (MODE === "live") {
      awbNumber =
        r.data?.awb_code ||
        r.data?.response?.data?.awb_code ||
        null;
    }

    if (!awbNumber) {
      awbNumber = generateDummyAWB();
    }

  await db.ref(`orders/${order.userId}/${order.orderId}`).update({
  // shipment info
  shipmentId: r.data.shipment_id || null,
  shipmentOrderId: r.data.order_id || null,
  awbCode: awbNumber,
  shipmentMode: MODE,
  shippedAt: new Date().toISOString(),

  // 🔥 IMPORTANT: customer & location (ADMIN PANEL FIX)
  customerName: order.customer_name,
  address: order.address,
  city: order.city,
  state: order.state || "",
  pincode: order.pincode,
  phone: order.phone || "",
  email: order.email || "",
});


    return res.json({
      success: true,
      mode: MODE,
      awb: awbNumber,
      order_id: r.data.order_id || order.orderId,
      shipment_id: r.data.shipment_id || "test-shipment",
    });
  } catch (err) {
    console.error(
      "CREATE SHIPMENT ERROR:",
      err.response?.data || err.message
    );

    return res.status(500).json({
      success: false,
      message: "Shipment creation failed",
      error: err.response?.data || err.message,
    });
  }
});

// ----------------------------------------------------
// TRACK SHIPMENT
// ----------------------------------------------------
app.get("/track/:awb", async (req, res) => {
  try {
    const { awb } = req.params;

    if (!awb) {
      return res.status(400).json({
        success: false,
        message: "Missing awb",
      });
    }

    if (MODE === "test") {
      return res.json({
        success: true,
        data: {
          awb,
          current_status: "In Transit",
          message: "TEST MODE — This is sample tracking data",
        },
      });
    }

    const token = await getShiprocketToken();

    const r = await axios.get(
      `${SHIPROCKET_BASE}/courier/track/awb/${awb}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000,
      }
    );

    return res.json({ success: true, data: r.data });
  } catch (err) {
    console.error(
      "TRACK ERROR:",
      err.response?.data || err.message
    );

    return res.status(500).json({
      success: false,
      message: "Tracking failed",
      error: err.response?.data || err.message,
    });
  }
});

// ----------------------------------------------------
// USER REQUEST CANCEL
// ----------------------------------------------------
app.post("/request-cancel", async (req, res) => {
  try {
    const { userId, orderId, reason } = req.body;

    if (!userId || !orderId) {
      return res.status(400).json({
        success: false,
        message: "Missing fields",
      });
    }

    await db
      .ref(`cancelRequests/${userId}/${orderId}`)
      .set({
        orderId,
        reason,
        requestedAt: new Date().toISOString(),
        status: "Pending",
      });

    await db
      .ref(`orders/${userId}/${orderId}`)
      .update({
        cancelRequested: true,
        status: "Pending Cancel",
      });

    return res.json({
      success: true,
      message: "Cancel request submitted",
    });
  } catch (err) {
    console.error("REQUEST CANCEL ERROR:", err);

    return res.status(500).json({
      success: false,
      message: "Failed",
      error: err.message,
    });
  }
});

// -------------------------------------------------------
// ADMIN APPROVE CANCEL
// -------------------------------------------------------
app.post("/admin/approve-cancel", async (req, res) => {
  try {
    const { userId, orderId } = req.body;

    if (!userId || !orderId) {
      return res.status(400).json({
        success: false,
        message: "Missing user/order",
      });
    }

    const orderRef = db.ref(`orders/${userId}/${orderId}`);
    const orderSnap = await orderRef.once("value");

    if (!orderSnap.exists()) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const order = orderSnap.val();

    if (
      MODE === "live" &&
      (order.shipmentOrderId || order.shipmentId)
    ) {
      try {
        const token = await getShiprocketToken();
        const ids = [];

        if (order.shipmentOrderId) ids.push(order.shipmentOrderId);
        if (order.shipmentId) ids.push(order.shipmentId);

        if (ids.length > 0) {
          await axios.post(
            `${SHIPROCKET_BASE}/orders/cancel`,
            { ids },
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            }
          );
        }
      } catch (e) {
        console.log(
          "Shiprocket cancel warning:",
          e.response?.data || e.message
        );
      }
    }

    await orderRef.update({
      status: "Cancelled",
      cancelReason: "Approved by admin",
      cancelledAt: new Date().toISOString(),
      cancelledByAdmin: true,
    });

    return res.json({
      success: true,
      message: "Order cancelled",
    });
  } catch (err) {
    console.error("APPROVE CANCEL ERROR:", err);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
});

// ----------------------------------------------------
// STATUS CHECK
// ----------------------------------------------------
app.get("/", (req, res) =>
  res.json({
    ok: true,
    mode: MODE,
    time: new Date().toISOString(),
  })
);

// ----------------------------------------------------
app.listen(PORT, () =>
  console.log(
    `🚀 Server running on port ${PORT} | MODE: ${MODE}`
  )
);
