// firebaseAdmin.js
import dotenv from "dotenv";
dotenv.config();

console.log("DB URL =>", process.env.FIREBASE_DB_URL); 
import admin from "firebase-admin";
import fs from "fs";

if (!admin.apps.length) {
  let serviceAccount;

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    // ✅ Railway / Production
    serviceAccount = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    );
  } else {
    // ✅ Local development
    serviceAccount = JSON.parse(
      fs.readFileSync("./serviceAccountKey.json", "utf8")
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DB_URL,
  });
}

export const db = admin.database();
