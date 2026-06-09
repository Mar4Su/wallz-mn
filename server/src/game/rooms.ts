import type { GameState, PlayerId } from "../../../shared/types";
import { createGame } from "./createGame";

export type Room = {
  id: string;
  game: GameState;
  sockets: Partial<Record<PlayerId, string>>;
};

const rooms = new Map<string, Room>();

function makeRoomId(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  for (let i = 0; i < 5; i += 1) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return id;
}

export function createRoom(socketId: string): Room {
  let id = makeRoomId();
  while (rooms.has(id)) id = makeRoomId();

  const room: Room = {
    id,
    game: createGame(id),
    sockets: { P1: socketId },
  };

  rooms.set(id, room);
  return room;
}

export function joinRoom(roomId: string, socketId: string): { room?: Room; playerId?: PlayerId; error?: string } {
  const room = rooms.get(roomId.toUpperCase());
  if (!room) return { error: "Room not found." };

  if (!room.sockets.P1) {
    room.sockets.P1 = socketId;
    return { room, playerId: "P1" };
  }

  if (!room.sockets.P2) {
    room.sockets.P2 = socketId;
    room.game.status = "playing";
    return { room, playerId: "P2" };
  }

  return { error: "Room is full." };
}

export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId.toUpperCase());
}

export function removeSocketFromRooms(socketId: string): void {
  for (const [roomId, room] of rooms.entries()) {
    if (room.sockets.P1 === socketId) room.sockets.P1 = undefined;
    if (room.sockets.P2 === socketId) room.sockets.P2 = undefined;

    if (!room.sockets.P1 && !room.sockets.P2) {
      rooms.delete(roomId);
    }
  }
}
