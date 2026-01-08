import fetch from "node-fetch";

const response = await fetch("http://localhost:5000/generate-awb", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    shipment_id: 123456789, // yaha shipment_id paste karo
  }),
});

const data = await response.json();
console.log("AWB Response:", data);
