// testShipment.js
import fetch from "node-fetch";

const response = await fetch("http://localhost:5000/create-shipment", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    orderId: "ORD123",
    customer_name: "Khan Alfiya Khatoon",
    address: "Near Railway Station, Bilimora",
    city: "Surat",
    state: "Gujarat",
    pincode: "396321",
    phone: "9876543210",
    email: "alfiya@gmail.com",
    payment_method: "Prepaid",
    price: 499,
    items: [
      { name: "White Top", sku: "WT001", units: 1, selling_price: 499 }
    ],
  }),
});

const data = await response.json();
console.log("Shipment Response:", data);
