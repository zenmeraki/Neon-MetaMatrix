import { getSession } from "./utils/sessionHandler.js";
import logger from "./utils/loggerUtils.js";

let ioInstance;
const userSocketMap = new Map(); // userId => socket.id
const lastEmitAtBySocket = new Map();

const SOCKET_EMIT_INTERVAL_MS = Number(process.env.SOCKET_EMIT_INTERVAL_MS || 250);

function normalizeShop(shop) {
  const normalized = String(shop || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(normalized)
    ? normalized
    : null;
}

export const initSocket = (io) => {
  ioInstance = io;

  io.use(async (socket, next) => {
    try {
      const shop = normalizeShop(
        socket.handshake.auth?.shop || socket.handshake.query?.shop,
      );

      if (!shop) {
        next(new Error("Socket shop is required"));
        return;
      }

      await getSession(shop);
      socket.data.shop = shop;
      next();
    } catch {
      next(new Error("Socket authentication failed"));
    }
  });

  io.on("connection", (socket) => {
    logger.info("Socket connected", {
      socketId: socket.id,
      shop: socket.data.shop,
    });

    socket.on("register_store", (userId) => {
      if (userId === socket.data.shop) {
        userSocketMap.set(userId, socket.id);
      }
    });

    socket.on("disconnect", () => {
      logger.info("Socket disconnected", {
        socketId: socket.id,
        shop: socket.data.shop,
      });
      lastEmitAtBySocket.delete(socket.id);
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
    const now = Date.now();
    const lastEmitAt = lastEmitAtBySocket.get(socketId) || 0;
    if (now - lastEmitAt < SOCKET_EMIT_INTERVAL_MS) {
      return false;
    }

    lastEmitAtBySocket.set(socketId, now);
    ioInstance.to(socketId).emit(event, data);
    return true;
  }

  return false;
};
