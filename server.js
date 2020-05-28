const server = require("http").createServer();
const io = require("socket.io")(server);

io.on("connection", (client) => {
  console.log(`client ${client.id} connected`);

  client.on("disconnect", () => {
    console.log(`client ${client.id} disconnected`);
  });
});

server.listen(8080);
