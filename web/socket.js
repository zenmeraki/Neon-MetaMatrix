import logger from "./utils/loggerUtils.js";
import { verifySyncSocketToken } from "./utils/syncSocketAuth.js";

let ioInstance;

function getShopRoom(shop) {
  return `shop:${shop}`;
}

export const initSocket = (io) => {
  ioInstance = io;

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;

      if (!token) {
        const error = new Error("Missing sync socket token");
        error.data = { code: "SYNC_SOCKET_UNAUTHORIZED" };
        return next(error);
      }

      const payload = verifySyncSocketToken(token);
      socket.data.shop = payload.shop;
      return next();
    } catch (error) {
      logger.warn("Rejected sync socket connection", {
        reason: error.message,
        socketId: socket.id,
      });

      const authError = new Error("Invalid sync socket token");
      authError.data = { code: "SYNC_SOCKET_UNAUTHORIZED" };
      return next(authError);
    }
  });

  io.on("connection", (socket) => {
    const shop = socket.data?.shop;

    if (!shop) {
      socket.disconnect(true);
      return;
    }

    socket.join(getShopRoom(shop));

    logger.info("Sync socket connected", {
      socketId: socket.id,
      shop,
    });

    socket.on("disconnect", (reason) => {
      logger.info("Sync socket disconnected", {
        socketId: socket.id,
        shop,
        reason,
      });
    });
  });
};

export const emitToUser = (shop, event, data) => {
  if (!ioInstance || !shop) {
    return;
  }

  ioInstance.to(getShopRoom(shop)).emit(event, data);
};
