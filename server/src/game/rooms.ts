import type { AiDifficulty, ClientPlayerProfile, GameState, PlayerId, PlayerState } from "../../../shared/types";
import { createGame } from "./createGame";
import type { RankedPlayer } from "../ranked";

const GUEST_AVATAR_ID = "-1.png";

export type RematchState = {
  requester: PlayerId;
  timeout?: NodeJS.Timeout;
  expiresAt: number;
};

export type Room = {
  id: string;
  game: GameState;
  sockets: Partial<Record<PlayerId, string>>;
  disconnected?: Partial<Record<PlayerId, { endsAt: number; timeout: NodeJS.Timeout }>>;
  turnTimeout?: NodeJS.Timeout;
  aiTimeout?: NodeJS.Timeout;
  aiDifficulty?: AiDifficulty;
  rematch?: RematchState;
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

function uniqueRoomId(): string {
  let id = makeRoomId();
  while (rooms.has(id)) id = makeRoomId();
  return id;
}

function findRoomById(roomId: string): Room | undefined {
  return rooms.get(roomId) ?? rooms.get(roomId.toUpperCase());
}

function fallbackName(playerId: PlayerId): string {
  return playerId === "P1" ? "Player 1" : "Player 2";
}

export function applyPlayerProfile(player: PlayerState, profile?: ClientPlayerProfile): void {
  player.uid = profile?.uid;
  player.publicId = profile?.publicId;
  player.avatarId = profile?.avatarId ?? GUEST_AVATAR_ID;
  player.profileColor = profile?.profileColor;
  player.name = profile?.displayName || profile?.publicId || fallbackName(player.id);
  player.avatar = profile?.avatarId || GUEST_AVATAR_ID;
  player.elo = profile?.elo ?? player.elo;
  player.record = {
    wins: profile?.wins ?? player.record.wins,
    losses: profile?.losses ?? player.record.losses,
  };
}

export function clearAbandonment(room: Room): void {
  for (const state of Object.values(room.disconnected ?? {})) {
    if (state?.timeout) clearTimeout(state.timeout);
  }
  room.disconnected = undefined;
  if (room.game.clocks) {
    room.game.clocks.disconnectedPlayer = undefined;
    room.game.clocks.disconnectEndsAt = undefined;
  }
}

export function clearPlayerDisconnect(room: Room, playerId: PlayerId): void {
  const state = room.disconnected?.[playerId];
  if (state?.timeout) clearTimeout(state.timeout);
  if (room.disconnected) {
    delete room.disconnected[playerId];
    if (!room.disconnected.P1 && !room.disconnected.P2) room.disconnected = undefined;
  }
  if (room.game.clocks?.disconnectedPlayer === playerId) {
    room.game.clocks.disconnectedPlayer = undefined;
    room.game.clocks.disconnectEndsAt = undefined;
  }
}

export function createRoom(socketId: string, profile?: ClientPlayerProfile): Room {
  const id = uniqueRoomId();

  const room: Room = {
    id,
    game: createGame(id),
    sockets: { P1: socketId },
  };
  applyPlayerProfile(room.game.players.P1, profile);

  rooms.set(id, room);
  return room;
}

export function createCasualRoom(
  p1SocketId: string,
  p2SocketId: string,
  p1Profile?: ClientPlayerProfile,
  p2Profile?: ClientPlayerProfile
): Room {
  const id = uniqueRoomId();
  const room: Room = {
    id,
    game: createGame(id),
    sockets: { P1: p1SocketId, P2: p2SocketId },
  };

  room.game.matchType = "casual";
  room.game.status = "playing";
  applyPlayerProfile(room.game.players.P1, p1Profile);
  applyPlayerProfile(room.game.players.P2, p2Profile);
  rooms.set(id, room);
  return room;
}

export function createAiRoom(socketId: string, profile?: ClientPlayerProfile, difficulty: AiDifficulty = "normal"): Room {
  const id = uniqueRoomId();
  const room: Room = {
    id,
    game: createGame(id),
    sockets: { P1: socketId },
    aiDifficulty: difficulty,
  };

  room.game.matchType = "ai";
  room.game.aiDifficulty = difficulty;
  room.game.status = "playing";
  applyPlayerProfile(room.game.players.P1, profile);
  applyPlayerProfile(room.game.players.P2, {
    displayName: difficulty === "pro" ? "Wallz Bot Pro" : "Wallz Bot",
    publicId: `wallz_bot_${difficulty}`,
    avatarId: GUEST_AVATAR_ID,
    profileColor: "red",
    elo: 1000,
    wins: 0,
    losses: 0,
  });
  rooms.set(id, room);
  return room;
}

function rankedProfile(player: RankedPlayer): ClientPlayerProfile {
  return {
    uid: player.uid,
    displayName: player.displayName,
    publicId: player.publicId,
    avatarId: player.avatarId,
    profileColor: player.profileColor,
    elo: player.startingElo,
  };
}

export function connectRankedRoom(matchId: string, players: RankedPlayer[], uid: string, socketId: string): { room?: Room; playerId?: PlayerId; error?: string } {
  const playerIndex = players.findIndex((player) => player.uid === uid);
  if (playerIndex < 0) return { error: "Player is not in this ranked match." };

  const playerId: PlayerId = playerIndex === 0 ? "P1" : "P2";
  let room = rooms.get(matchId);

  if (!room) {
    room = {
      id: matchId,
      game: createGame(matchId),
      sockets: {},
    };
    room.game.matchId = matchId;
    room.game.matchType = "ranked";
    room.game.status = "playing";
    applyPlayerProfile(room.game.players.P1, rankedProfile(players[0]));
    applyPlayerProfile(room.game.players.P2, rankedProfile(players[1]));
    rooms.set(matchId, room);
  }

  room.sockets[playerId] = socketId;
  clearPlayerDisconnect(room, playerId);
  return { room, playerId };
}

export function joinRoom(roomId: string, socketId: string, profile?: ClientPlayerProfile): { room?: Room; playerId?: PlayerId; error?: string } {
  const room = findRoomById(roomId);
  if (!room) return { error: "Room not found." };
  if (room.game.status === "playing") return { error: "Room already in progress." };

  if (!room.sockets.P1) {
    room.sockets.P1 = socketId;
    applyPlayerProfile(room.game.players.P1, profile);
    clearAbandonment(room);
    return { room, playerId: "P1" };
  }

  if (!room.sockets.P2) {
    room.sockets.P2 = socketId;
    applyPlayerProfile(room.game.players.P2, profile);
    clearAbandonment(room);
    room.game.status = "playing";
    return { room, playerId: "P2" };
  }

  return { error: "Room is full." };
}

export function rejoinRoom(roomId: string, playerId: PlayerId, socketId: string, profile?: ClientPlayerProfile, uid?: string): { room?: Room; playerId?: PlayerId; error?: string } {
  const room = findRoomById(roomId);
  if (!room) return { error: "Room not found." };

  const player = room.game.players[playerId];
  if (!player) return { error: "Invalid player seat." };
  if (room.game.matchType === "ranked" && (!uid || player.uid !== uid)) {
    return { error: "This ranked seat belongs to another player." };
  }
  if (player.uid && profile?.uid && player.uid !== profile.uid) {
    return { error: "This seat belongs to another player." };
  }

  room.sockets[playerId] = socketId;
  if (profile) applyPlayerProfile(player, { ...profile, uid: player.uid ?? profile.uid });
  clearPlayerDisconnect(room, playerId);
  return { room, playerId };
}

export function getRoom(roomId: string): Room | undefined {
  return findRoomById(roomId);
}

export function findSocketRoom(socketId: string): { room: Room; playerId: PlayerId } | null {
  for (const room of rooms.values()) {
    if (room.sockets.P1 === socketId) return { room, playerId: "P1" };
    if (room.sockets.P2 === socketId) return { room, playerId: "P2" };
  }
  return null;
}

export function otherPlayer(playerId: PlayerId): PlayerId {
  return playerId === "P1" ? "P2" : "P1";
}

export function clearRematch(room: Room): void {
  if (room.rematch?.timeout) clearTimeout(room.rematch.timeout);
  room.rematch = undefined;
}

export function clearTurnTimeout(room: Room): void {
  if (room.turnTimeout) clearTimeout(room.turnTimeout);
  room.turnTimeout = undefined;
}

export function clearAiTimeout(room: Room): void {
  if (room.aiTimeout) clearTimeout(room.aiTimeout);
  room.aiTimeout = undefined;
}

export function createRematchRoom(oldRoom: Room): Room {
  clearRematch(oldRoom);
  clearAbandonment(oldRoom);
  clearTurnTimeout(oldRoom);
  clearAiTimeout(oldRoom);
  const id = uniqueRoomId();
  const nextRoom: Room = {
    id,
    game: createGame(id, oldRoom.game.players),
    sockets: { ...oldRoom.sockets },
  };
  nextRoom.game.status = "playing";
  rooms.delete(oldRoom.id);
  rooms.set(id, nextRoom);
  return nextRoom;
}

export function removeSocketFromRooms(socketId: string): void {
  for (const [roomId, room] of rooms.entries()) {
    if (room.sockets.P1 === socketId) room.sockets.P1 = undefined;
    if (room.sockets.P2 === socketId) room.sockets.P2 = undefined;

    if (!room.sockets.P1 && !room.sockets.P2) {
      clearRematch(room);
      clearAbandonment(room);
      clearTurnTimeout(room);
      clearAiTimeout(room);
      rooms.delete(roomId);
    }
  }
}
