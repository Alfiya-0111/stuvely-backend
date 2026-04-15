import fs from "fs";
// import Razorpay from "razorpay";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import admin from "firebase-admin";

import { db } from "./firebaseAdmin.js";


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
// const razorpay = new Razorpay({
//   key_id: process.env.RAZORPAY_KEY,
//   key_secret: process.env.RAZORPAY_SECRET,
// });
// ----------------------------------------------------




// 🔥 SITEMAP ROUTE
app.get("/sitemap.xml", async (req, res) => {
  try {
    let urls = [];

    // 🔹 Static Pages
    const staticPages = [
      "/",
      "/about",
      "/contact",
      "/privacy",
      "/security",
      "/cancellation",
      "/payment",
    ];

    staticPages.forEach(page => {
      urls.push(`
        <url>
          <loc>https://stuvely.com${page}</loc>
          <changefreq>monthly</changefreq>
          <priority>0.8</priority>
        </url>
      `);
    });

    // 🔹 Collections + Products
    const snap = await db.ref("ourcollections").once("value");
    const collections = snap.val();

    console.log("🔥 COLLECTION DATA:", collections);

    if (collections) {
      Object.entries(collections).forEach(([collectionId, collection]) => {
        if (!collection.slug) return;

        const collectionSlug = collection.slug;

        // ✅ Collection page
        urls.push(`
          <url>
            <loc>https://stuvely.com/collections/${collectionSlug}</loc>
            <changefreq>weekly</changefreq>
            <priority>0.9</priority>
          </url>
        `);

        // ✅ Products inside collection
        if (collection.products) {
          Object.entries(collection.products).forEach(([productId, product]) => {
            urls.push(`
              <url>
                <loc>https://stuvely.com/collections/${collectionSlug}/product/${productId}</loc>
                <changefreq>weekly</changefreq>
                <priority>0.9</priority>
              </url>
            `);
          });
        }
      });
    }

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("")}
</urlset>`;

    res.set("Content-Type", "application/xml");
    res.send(sitemap);

    console.log("✅ Sitemap generated successfully");

  } catch (err) {
    console.error("❌ Sitemap error:", err);
    res.status(500).send("Sitemap error");
  }
});


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
// -------------------------------------------------------
// CREATE SHIPMENT - UPDATED
// -------------------------------------------------------
// -------------------------------------------------------
// CREATE SHIPMENT - FULLY WORKING WITH AUTO AWB
// -------------------------------------------------------
app.post("/create-shipment", async (req, res) => {
  try {
    const order = req.body || {};

    // Validation
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
    const orderItems = buildOrderItems(order.items, { price: order.price });
    const sub_total = orderItems.reduce(
      (sum, it) => sum + Number(it.selling_price || 0) * Number(it.units || 1),
      0
    );

    // Unique Order ID
    const uniqueOrderId = `${order.orderId}-${Date.now()}`;

    let shipmentId = null;
    let awbCode = null;

    // REAL SHIPROCKET CALL
    if (MODE === "live") {
      // Step 1: Create Order
      const orderPayload = {
        order_id: uniqueOrderId,
        order_date: new Date().toISOString(),
        pickup_location: SHIPROCKET_PICKUP.trim(),
        billing_customer_name: order.customer_name.split(" ")[0] || "Customer",
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
      };

      console.log("🔥 Creating order:", uniqueOrderId);

      const orderRes = await axios.post(
        `${SHIPROCKET_BASE}/orders/create/adhoc`,
        orderPayload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          timeout: 30000,
        }
      );

      console.log("🔥 Order Response:", JSON.stringify(orderRes.data, null, 2));

      // Extract shipment_id
      shipmentId = orderRes.data?.shipment_id || 
                   orderRes.data?.payload?.shipment_id ||
                   orderRes.data?.data?.shipment_id;

      if (!shipmentId) {
        throw new Error("No shipment_id returned from Shiprocket");
      }

      console.log("🔥 Shipment ID:", shipmentId);

      // Step 2: Generate AWB (AUTO-SELECT COURIER)
      console.log("🔥 Generating AWB with auto-courier selection...");
      
      try {
        const awbRes = await axios.post(
          `${SHIPROCKET_BASE}/courier/assign/awb`,
          {
            shipment_id: [shipmentId],  // 🔥 Array format (required)
            courier_id: null,            // 🔥 Auto-select cheapest courier
            // courier_id: 10,           // 👈 Ya specific courier: 10=Delhivery, 1=Bluedart
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            timeout: 30000,
          }
        );

        console.log("🔥 AWB Response:", JSON.stringify(awbRes.data, null, 2));

        // Parse AWB from multiple possible response structures
        if (awbRes.data?.awb_assign?.[0]?.awb_code) {
          awbCode = awbRes.data.awb_assign[0].awb_code;
        } else if (awbRes.data?.response?.data?.[0]?.awb_code) {
          awbCode = awbRes.data.response.data[0].awb_code;
        } else if (awbRes.data?.data?.[0]?.awb_code) {
          awbCode = awbRes.data.data[0].awb_code;
        }

        console.log("🔥 Final AWB Code:", awbCode);

      } catch (awbErr) {
        console.error("🔥 AWB Generation Error:", awbErr.response?.data || awbErr.message);
        // Continue without AWB - order is still created
        awbCode = null;
      }
    }

    // Save to Firebase (with or without AWB)
    await db.ref(`orders/${order.userId}/${order.orderId}`).update({
      shipmentId: shipmentId,
      shipmentOrderId: uniqueOrderId,
      awbCode: awbCode,  // null if AWB failed, actual code if success
      shipmentMode: MODE,
      shippedAt: new Date().toISOString(),
      customerName: order.customer_name,
      address: order.address,
      city: order.city,
      state: order.state || "",
      pincode: order.pincode,
      phone: order.phone || "",
      email: order.email || "",
      awbPending: !awbCode,  // true if AWB not generated
    });

    // Return response
    return res.json({
      success: true,
      mode: MODE,
      awb: awbCode,  // 🔥 Yeh AWB code hoga (null agar fail hua)
      message: awbCode ? "✅ Shipment created with AWB" : "⚠️ Shipment created, AWB pending",
      order_id: uniqueOrderId,
      shipment_id: shipmentId,
    });

  } catch (err) {
    console.error("❌ CREATE SHIPMENT ERROR:", err.response?.data || err.message);
    
    if (err.response?.data) {
      console.error("❌ Full Error:", JSON.stringify(err.response.data, null, 2));
    }

    return res.status(500).json({
      success: false,
      message: "Shipment creation failed",
      error: err.response?.data || err.message,
    });
  }
});
// RAZORPAY REFUND
// ----------------------------------------------------
// app.post("/refund", async (req, res) => {
//   try {
//     const { paymentId, amount } = req.body;

//     if (!paymentId || !amount) {
//       return res.status(400).json({
//         success: false,
//         message: "Missing paymentId / amount",
//       });
//     }

//     if (MODE === "test") {
//       console.log("🟡 TEST MODE REFUND:", paymentId);
//       return res.json({
//         success: true,
//         message: "Test refund simulated",
//       });
//     }

//     const refund = await razorpay.payments.refund(paymentId, {
//       amount: Math.round(amount * 100), // paisa
//     });

//     console.log("✅ REFUND SUCCESS:", refund.id);

//     res.json({
//       success: true,
//       refundId: refund.id,
//     });
//   } catch (err) {
//     console.error("❌ REFUND ERROR:", err.response?.data || err.message);

//     res.status(500).json({
//       success: false,
//       message: "Refund failed",
//       error: err.response?.data || err.message,
//     });
//   }
// });

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
// ✅ REFUND IF PAID
// if (order.paymentStatus === "Paid" && order.razorpay_payment_id) {

//    console.log("💰 Initiating Razorpay Refund");

//    try {
//       await razorpay.payments.refund(order.razorpay_payment_id, {
//          amount: Math.round(order.total * 100),
//       });

//       console.log("✅ Refund Success");

//    } catch (e) {
//       console.log("⚠ Refund Warning:", e.message);
//    }
// }

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
app.post("/send-sms", async (req, res) => {
  try {
    const { phone, message } = req.body;

    if (!phone || !message) {
      return res.status(400).json({ success: false });
    }

    if (MODE === "test") {
      console.log("🟡 TEST SMS:", phone, message);
      return res.json({ success: true });
    }

    await axios.post("SMS_PROVIDER_API", {
      phone,
      message,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("SMS ERROR:", err.message);
    res.status(500).json({ success: false });
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
