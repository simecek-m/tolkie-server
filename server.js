require("dotenv").config();
const server = require("http").createServer();
const io = require("socket.io")(server);
const firebase = require("firebase-admin");
const logger = require("./logger");

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
  logger.info("New socket connection -> authentication");
  if (token == null) {
    logger.info("Authentication token was null!");
    next({ message: "No auth token received!" });
  } else {
    try {
      const user = await firebase.auth().verifyIdToken(token);
      socket.userId = user.uid;
      logger.info("Token was successfully verified");
      next();
    } catch (error) {
      next(error);
      logger.error("Token verification failed", error);
    }
  }
});

io.on("connection", async (client) => {
  logger.info(`client ${client.id} connected`);

  client.on("friend-requests", () => {
    db.collection("friend_requests")
      .where("to", "==", client.userId)
      .get()
      .then((snapshot) => {
        const usersBy = snapshot.docs.map((doc) => doc.data().by);
        if(usersBy.length > 0) {
          db.collection("users")
          .where(firebase.firestore.FieldPath.documentId(), "in", usersBy)
          .get()
          .then((snapshot) => {
            const result = snapshot.docs.map((doc) => ({
              id: doc.id,
              ...doc.data()
            })
          );
            client.emit("friend-requests", result);
          })
          .catch((error) => {
            logger.error("Error while reading data from users collection", error);
          });
        } else {
          logger.info(`No friend request for user ${client.id} was found!`)
        }
     })
     .catch((error) => {
      logger.error("Error while reading data from friend_requests collection", error);
    });
        
  });

  client.on("reject-friend-request", byUserId => {
    logger.info(`user ${client.userId} rejected friend request by: ${byUserId}`)
    db.collection("friend_requests")
      .where("to", "==", client.userId)
      .where("by", "==", byUserId)
      .get()
      .then(snapshot => {
        snapshot.docs.forEach(doc => doc.ref.delete())
      })
  });

  client.on("disconnect", () => {
    logger.info(`client ${client.id} disconnected`);
  });
});

server.listen(process.env.PORT, () => {
  logger.info(`Application is running on port ${process.env.PORT}`);
});
