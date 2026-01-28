import admin from "firebase-admin";

// Railway ENV variable se service account uthao
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://stuvely-data-default-rtdb.firebaseio.com",
  });
}

// ✅ YAHI EXPORT MISS THA
export const db = admin.database();
export default admin;