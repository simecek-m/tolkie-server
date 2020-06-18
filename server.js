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

  client.on("get-friend-requests", () => {
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

  client.on("accept-friend-request", async byUserId => {
    logger.info(`user ${client.userId} accepted friend request by: ${byUserId}`)
    try {
      const clientRef = db.collection("users").doc(client.userId)
      const personRef = db.collection("users").doc(byUserId)
      clientRef.update({
        friends: firebase.firestore.FieldValue.arrayUnion(byUserId)
      })
      personRef.update({
        friends: firebase.firestore.FieldValue.arrayUnion(client.userId)
      })
      db.collection("friend_requests")
        .where("to", "==", client.userId)
        .where("by", "==", byUserId)
        .get()
        .then(snapshot => {
          snapshot.docs.forEach(doc => doc.ref.delete())
        })
    } catch(error) {
      logger.error("Error while accepting friend request", error)
    }
    
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

  client.on("get-friend-list", async () => {
    logger.info(`user ${client.userId} friend list event triggered`);
    const userRef = await db.collection("users").doc(client.userId).get()
    const friendIds = userRef.data().friends

    db.collection("users")
      .where(firebase.firestore.FieldPath.documentId(), "in", friendIds)
      .orderBy(firebase.firestore.FieldPath.documentId())
      .get()
      .then((snapshot) => {
        const result = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        client.emit("friend-list", result);
      })
  });

  client.on("get-chats", async() => {
    const chatsRef = await db.collection("chats").where("participants", "array-contains", client.userId).get();
    const result = await Promise.all(chatsRef.docs.map(async doc => {
      let participants = await Promise.all(doc.data().participants.filter(user => user != client.userId).map(async participantId => {
        const user = await db.collection("users").doc(participantId).get()
        return {
          id: participantId,
          ...user.data()
        }
      }))
      participants = participants.filter(participant => participant != null && participant != undefined)
      const messagesRef = await doc.ref.collection("messages").limit(20).orderBy("timestamp", "asc").get()
      const messages = messagesRef.docs.map(message => message.data());
      return {
        id: doc.id,
        ...doc.data(),
        participants,
        messages
      }
    }));
    client.emit("chats", result)
  });

  client.on("create-new-chat-room", async (userId) => {
    const docRef = await db.collection("chats").add({
      participants: [client.userId, userId],
      updated: new Date().getTime()
    });
    const doc = await docRef.get()
    const chat = {
      id: doc.id,
      ...doc.data(),
      messages: []
    };
    const filteredParticipants = await Promise.all(chat.participants.filter(user => user != client.userId).map(async participant => {
      const user = await db.collection("users").doc(participant).get()
      return user.data()
    }))
    chat.participants = filteredParticipants
    client.emit("new-chat-room", chat)
  });


  client.on("disconnect", () => {
    logger.info(`client ${client.id} disconnected`);
  });
});

server.listen(process.env.PORT, () => {
  logger.info(`Application is running on port ${process.env.PORT}`);
});
