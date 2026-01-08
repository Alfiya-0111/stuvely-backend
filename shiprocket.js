import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const BASE_URL = "https://apiv2.shiprocket.in/v1/external";
let shiprocketToken = null;

// 🔑 Generate token
export async function getShiprocketToken() {
  if (shiprocketToken) return shiprocketToken;
  const res = await axios.post(`${BASE_URL}/auth/login`, {
    email: process.env.SHIPROCKET_EMAIL,
    password: process.env.SHIPROCKET_PASSWORD,
  });
  shiprocketToken = res.data.token;
  console.log("✅ Shiprocket token generated");
  return shiprocketToken;
}

// 📦 Create Shipment
export async function createShipment(order) {
  const token = await getShiprocketToken();

  const payload = {
    order_id: order.order_id || `ORDER-${Date.now()}`,
    order_date: new Date().toISOString(),
    pickup_location: process.env.SHIPROCKET_PICKUP,
    billing_customer_name: order.customer_name || "Unnamed Customer",
    billing_address: order.address,
    billing_city: order.city,
    billing_pincode: order.pincode,
    billing_state: order.state,
    billing_country: "India",
    billing_email: order.email || "test@mail.com",
    billing_phone: String(order.phone),
    shipping_is_billing: true,
    order_items: order.items || [
      { name: "Default Product", sku: "SKU001", units: 1, selling_price: order.price || 100 },
    ],
    payment_method: order.payment_method || "COD",
    sub_total: order.price || 100,
    length: 10,
    breadth: 10,
    height: 10,
    weight: 0.5,
  };

  const response = await axios.post(`${BASE_URL}/orders/create/adhoc`, payload, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });

  console.log("✅ Shipment Created:", response.data);
  return response.data;
}

// 🚚 Track Shipment
export async function trackShipment(awb) {
  const token = await getShiprocketToken();
  const res = await axios.get(`${BASE_URL}/courier/track/awb/${awb}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
}
