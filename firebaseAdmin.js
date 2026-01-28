import admin from "firebase-admin";

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://stuvely-data-default-rtdb.firebaseio.com"
});

export default admin;