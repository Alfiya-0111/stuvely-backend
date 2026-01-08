// sendPush.js (server)
const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const registrationToken = "USER_DEVICE_TOKEN";

const message = {
  notification: {
    title: "Hello",
    body: "This is a test push"
  },
  token: registrationToken
};

admin.messaging().send(message)
  .then(response => console.log("Successfully sent:", response))
  .catch(err => console.error("Error sending message:", err));
