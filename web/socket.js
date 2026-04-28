let ioInstance;
const userSocketMap = new Map(); // userId => socket.id
export const initSocket = (io) => {
  ioInstance = io;

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("register_store", (userId) => {
      userSocketMap.set(userId, socket.id);
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      for (const [userId, socketId] of userSocketMap.entries()) {
        if (socketId === socket.id) {
          userSocketMap.delete(userId);
          break;
        }
      }
    });
  });
};

export const emitToUser = (userId, event, data) => {
  const socketId = userSocketMap.get(userId) || null;
  if (ioInstance && socketId) {
    ioInstance.to(socketId).emit(event, data);
  }
};
