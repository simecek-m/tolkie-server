const server = require("http").createServer();
const io = require("socket.io")(server);
const firebase = require("firebase-admin");
require("dotenv").config();

// firebase service account is base64 encoded and load as environment variable
const serviceAccountBase64 = Buffer.from(
  process.env.GOOGLE_SERVICE_ACCOUNT,
  "base64"
);
const serviceAccount = JSON.parse(serviceAccountBase64.toString());

firebase.initializeApp({
  credential: firebase.credential.cert(serviceAccount),
  databaseURL: "https://tolkie-dcedc.firebaseio.com",
});

const db = firebase.firestore();

io.use(async (socket, next) => {
  const token = socket.handshake.query.token;
  if (token == null) {
    next({ message: "No auth token received!" });
  } else {
    try {
      const user = await firebase.auth().verifyIdToken(token);
      socket.userId = user.uid;
      console.log(`${user.email} authenticated!`);
      next();
    } catch (error) {
      next(error);
    }
  }
});

io.on("connection", async (client) => {
  console.log(`client ${client.id} connected`);

  client.on("friend-requests", () => {
    db.collection("friend_requests")
      .where("to", "==", client.userId)
      .get()
      .then((snapshot) => {
        const usersBy = snapshot.docs.map((doc) => doc.data().by);
        db.collection("users")
          .where(firebase.firestore.FieldPath.documentId(), "in", usersBy)
          .get()
          .then((snapshot) => {
            const result = snapshot.docs.map((doc) => doc.data());
            client.emit("friend-requests", result);
          })
          .catch((error) => {
            console.log(error);
          });
      })
      .catch((error) => {
        console.log(error);
      });
  });

  client.on("disconnect", () => {
    console.log(`client ${client.id} disconnected`);
  });
});

server.listen(process.env.PORT, () => {
  console.log(`Application is running on port ${process.env.PORT}`);
});
