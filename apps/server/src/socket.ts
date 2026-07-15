import {
  clientPingSchema,
  type ClientToServerEvents,
  type ServerToClientEvents
} from "@werewolf/shared";
import type { FastifyBaseLogger } from "fastify";
import { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { createServiceStatus } from "./app.js";

export function attachSocketServer(server: HttpServer, logger: FastifyBaseLogger) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
    cors: { origin: true, credentials: false }
  });

  io.on("connection", (socket) => {
    logger.info({ socketId: socket.id }, "socket connected");
    socket.emit("system:ready", createServiceStatus());

    socket.on("system:ping", (rawPayload) => {
      const result = clientPingSchema.safeParse(rawPayload);
      if (!result.success) {
        logger.warn({ socketId: socket.id }, "invalid socket ping ignored");
        return;
      }

      socket.emit("system:pong", {
        sentAt: result.data.sentAt,
        receivedAt: Date.now()
      });
    });

    socket.on("disconnect", (reason) => {
      logger.info({ socketId: socket.id, reason }, "socket disconnected");
    });
  });

  return io;
}

