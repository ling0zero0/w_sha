import {
  serviceStatusSchema,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type ServiceStatus
} from "@werewolf/shared";
import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";

type ConnectionState = "checking" | "connected" | "disconnected";

interface ServiceConnection {
  api: ConnectionState;
  socket: ConnectionState;
  service: ServiceStatus | null;
}

const initialState: ServiceConnection = {
  api: "checking",
  socket: "checking",
  service: null
};

export function useServiceConnection(): ServiceConnection {
  const [state, setState] = useState(initialState);

  useEffect(() => {
    const abortController = new AbortController();
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
      transports: ["websocket", "polling"]
    });

    void fetch("/api/bootstrap", { signal: abortController.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Bootstrap failed: ${response.status}`);
        return serviceStatusSchema.parse(await response.json());
      })
      .then((service) => {
        setState((current) => ({ ...current, api: "connected", service }));
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState((current) => ({ ...current, api: "disconnected" }));
      });

    socket.on("connect", () => {
      setState((current) => ({ ...current, socket: "connected" }));
      socket.emit("system:ping", { sentAt: Date.now() });
    });
    socket.on("connect_error", () => {
      setState((current) => ({ ...current, socket: "disconnected" }));
    });
    socket.on("disconnect", () => {
      setState((current) => ({ ...current, socket: "disconnected" }));
    });
    socket.on("system:ready", (service) => {
      setState((current) => ({ ...current, service }));
    });

    return () => {
      abortController.abort();
      socket.disconnect();
    };
  }, []);

  return state;
}

