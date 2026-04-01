import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { useAuthenticatedFetch } from "./useAuthenticatedFetch";

const SYNC_STATE_CHANGED_EVENT = "sync_state_changed";
const LEGACY_PRODUCT_SYNC_EVENT = "product_sync";

export default function useSyncRealtime({ enabled = true, onSyncEvent }) {
  const socketRef = useRef(null);
  const [connectionState, setConnectionState] = useState("idle");
  const fetchWithAuth = useAuthenticatedFetch();

  useEffect(() => {
    if (!enabled) {
      setConnectionState("idle");
      return undefined;
    }

    let cancelled = false;
    let socket = null;

    async function connect() {
      setConnectionState("authorizing");

      try {
        const response = await fetchWithAuth("/api/sync/socket-auth");
        if (!response) {
          throw new Error("Failed to authorize sync socket");
        }
        const result = await response.json();

        if (!response.ok || !result?.token) {
          throw new Error(result?.error || "Failed to authorize sync socket");
        }

        if (cancelled) {
          return;
        }

        socket = io({
          auth: {
            token: result.token,
          },
          transports: ["websocket"],
          reconnection: true,
          reconnectionAttempts: Infinity,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
        });

        socketRef.current = socket;

        const handleSyncEvent = (payload = {}) => {
          onSyncEvent?.(payload);
        };

        socket.on("connect", () => {
          setConnectionState("connected");
          handleSyncEvent({
            eventType: "connected",
            shop: result.shop,
          });
        });

        socket.on("disconnect", () => {
          setConnectionState("disconnected");
        });

        socket.on("connect_error", () => {
          setConnectionState("error");
        });

        socket.on(SYNC_STATE_CHANGED_EVENT, handleSyncEvent);
        socket.on(LEGACY_PRODUCT_SYNC_EVENT, handleSyncEvent);
      } catch {
        if (!cancelled) {
          setConnectionState("error");
        }
      }
    }

    connect();

    return () => {
      cancelled = true;

      if (socket) {
        socket.off(SYNC_STATE_CHANGED_EVENT);
        socket.off(LEGACY_PRODUCT_SYNC_EVENT);
        socket.disconnect();
      }

      socketRef.current = null;
    };
  }, [enabled, fetchWithAuth, onSyncEvent]);

  return {
    connectionState,
    isConnected: connectionState === "connected",
  };
}
