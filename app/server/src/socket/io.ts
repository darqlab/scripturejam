import type { Server } from "socket.io";
import type { ServerToClientEvents, ClientToServerEvents } from "@scripturejam/types";

export interface SocketData {
  code: string | null;
  playerId: string | null;
  role: "player" | "host" | null;
}

export type TypedServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

let _io: TypedServer | null = null;

export function setIo(instance: TypedServer): void {
  _io = instance;
}

export function getIo(): TypedServer {
  if (!_io) throw new Error("Socket.IO not initialized");
  return _io;
}
