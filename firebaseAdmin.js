import admin from "firebase-admin";

// 🔐 Railway ENV variable se service account uthao
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error("❌ FIREBASE_SERVICE_ACCOUNT ENV missing");
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} catch (err) {
  console.error("❌ FIREBASE_SERVICE_ACCOUNT JSON invalid");
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://stuvely-data-default-rtdb.firebaseio.com",
  });
}

// ✅ Proper export (ye hi missing tha pehle)
export const db = admin.database();
export default admin;