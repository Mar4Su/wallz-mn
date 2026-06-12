import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import {
  clearRematch,
  clearAbandonment,
  clearAiTimeout,
  clearPlayerDisconnect,
  clearTurnTimeout,
  activeHumanPlayerCount,
  connectRankedRoom,
  createAiRoom,
  createCasualRoom,
  createRematchRoom,
  createRoom,
  findSocketRoom,
  getRoom,
  joinRoom,
  otherPlayer,
  rejoinRoom,
  removeSocketFromRooms,
} from "./game/rooms";
import { applyGiveUp, applyPawnMove, applyTurnTimeout, applyWallPlacement, finishGame, getLegalPawnMoves } from "./game/rules";
import type { AiDifficulty, ChatMessage, ClientPlayerProfile, GameState, GiveUpPayload, MovePawnPayload, PlaceWallPayload, PlayerId, Position, RematchPayload, SendChatMessagePayload, TimeControlId, Wall } from "../../shared/types";
import { cancelRanked, enqueueRanked, finalizeRankedMatch, getLeaderboard, getLeaderboardRank, getRankedMatch, getRankedStatus, getUserMatchHistory, verifyBearerToken } from "./ranked";
import { resolveTimeControl } from "../../shared/timeControls";

const PORT = Number(process.env.PORT ?? 4000);
const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";
const REMATCH_MS = 10_000;
const ABANDONMENT_MS = 25_000;
const MAX_CHAT_MESSAGES = 50;
const MAX_CHAT_LENGTH = 180;
const AI_PLAYER_ID: PlayerId = "P2";
const HUMAN_PLAYER_ID: PlayerId = "P1";

type CasualQueueEntry = {
  socketId: string;
  profile?: ClientPlayerProfile;
  timeControlId: TimeControlId;
};

function resetTurnClock(room: NonNullable<ReturnType<typeof getRoom>>): void {
  const now = Date.now();
  const timeControl = room.game.timeControl ?? resolveTimeControl();
  room.game.timeControl = timeControl;
  room.game.clocks = {
    totalMs: room.game.clocks?.totalMs ?? { P1: timeControl.baseMs, P2: timeControl.baseMs },
    incrementMs: timeControl.incrementMs,
    turnMs: timeControl.turnMs,
    turnStartedAt: now,
    turnEndsAt: now + timeControl.turnMs,
    disconnectedPlayer: room.game.clocks?.disconnectedPlayer,
    disconnectEndsAt: room.game.clocks?.disconnectEndsAt,
  };
}

function addClockIncrement(room: NonNullable<ReturnType<typeof getRoom>>, playerId: PlayerId): void {
  if (!room.game.clocks) return;
  room.game.clocks.totalMs[playerId] += room.game.clocks.incrementMs;
}

function syncClockElapsed(room: NonNullable<ReturnType<typeof getRoom>>): boolean {
  if (room.game.status !== "playing") return false;
  if (!room.game.clocks) resetTurnClock(room);
  const clocks = room.game.clocks!;
  const playerId = room.game.currentTurn;
  const elapsed = Math.max(0, Date.now() - clocks.turnStartedAt);
  clocks.totalMs[playerId] = Math.max(0, clocks.totalMs[playerId] - elapsed);
  clocks.turnStartedAt = Date.now();

  if (clocks.totalMs[playerId] <= 0) {
    finishGame(room.game, otherPlayer(playerId), "timeout");
    clearTurnTimeout(room);
    return true;
  }

  return false;
}

function scheduleTurnTimeout(room: NonNullable<ReturnType<typeof getRoom>>): void {
  clearTurnTimeout(room);
  if (room.game.status !== "playing") return;
  if (!room.game.clocks) resetTurnClock(room);

  const clocks = room.game.clocks!;
  const playerId = room.game.currentTurn;
  const remainingTurnMs = Math.max(0, clocks.turnEndsAt - Date.now());
  const remainingTotalMs = Math.max(0, clocks.totalMs[playerId]);
  const delay = Math.max(0, Math.min(remainingTurnMs, remainingTotalMs));

  room.turnTimeout = setTimeout(() => {
    const latestRoom = getRoom(room.id);
    if (!latestRoom || latestRoom.game.status !== "playing") return;

    const timedOutByTotal = syncClockElapsed(latestRoom);
    if (timedOutByTotal) {
      io.to(latestRoom.id).emit("game-updated", latestRoom.game);
      io.to(latestRoom.id).emit("game-over", latestRoom.game);
      return;
    }

    const expiredPlayer = latestRoom.game.currentTurn;
    const result = applyTurnTimeout(latestRoom.game, expiredPlayer);
    if (result.ok) {
      resetTurnClock(latestRoom);
      io.to(latestRoom.id).emit("game-updated", latestRoom.game);
      scheduleTurnTimeout(latestRoom);
      scheduleAiTurn(latestRoom);
    }
  }, delay);
}

function emitRoomUpdate(room: NonNullable<ReturnType<typeof getRoom>>): void {
  io.to(room.id).emit("game-updated", room.game);
  if (room.game.winner) io.to(room.id).emit("game-over", room.game);
}

function isSeatedPlayer(room: NonNullable<ReturnType<typeof getRoom>>, playerId: PlayerId, socketId: string): boolean {
  return room.sockets[playerId] === socketId;
}

function cloneGame(game: GameState): GameState {
  return JSON.parse(JSON.stringify(game)) as GameState;
}

function goalRowFor(playerId: PlayerId, game: GameState): number {
  return playerId === "P1" ? 0 : game.boardSize - 1;
}

function distanceToGoal(game: GameState, playerId: PlayerId): number {
  const goalRow = goalRowFor(playerId, game);
  const start = game.players[playerId].position;
  const queue: Array<{ pos: Position; distance: number }> = [{ pos: start, distance: 0 }];
  const seen = new Set<string>([`${start.row},${start.col}`]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.pos.row === goalRow) return current.distance;

    const nextGame = cloneGame(game);
    nextGame.players[playerId].position = current.pos;
    for (const move of getLegalPawnMoves(nextGame, playerId)) {
      const key = `${move.row},${move.col}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ pos: move, distance: current.distance + 1 });
    }
  }

  return 99;
}

function aiMoveScore(room: NonNullable<ReturnType<typeof getRoom>>, move: Position, difficulty: AiDifficulty): number {
  const goalRow = goalRowFor(AI_PLAYER_ID, room.game);
  const goalDistance = Math.abs(goalRow - move.row);
  const centerBias = Math.abs(Math.floor(room.game.boardSize / 2) - move.col) * 0.08;
  const humanDistance = distanceToGoal(room.game, HUMAN_PLAYER_ID);
  const randomness = difficulty === "easy" ? 1.6 : difficulty === "normal" ? 0.8 : difficulty === "hard" ? 0.28 : 0.04;
  return goalDistance + centerBias - humanDistance * 0.05 + Math.random() * randomness;
}

function wallCandidates(game: GameState): Wall[] {
  const walls: Wall[] = [];
  for (let row = 0; row < game.boardSize - 1; row += 1) {
    for (let col = 0; col < game.boardSize - 1; col += 1) {
      walls.push({ row, col, orientation: "H" });
      walls.push({ row, col, orientation: "V" });
    }
  }
  return walls;
}

function bestAiWall(room: NonNullable<ReturnType<typeof getRoom>>, difficulty: AiDifficulty): Wall | null {
  if (room.game.players[AI_PLAYER_ID].wallsLeft <= 0) return null;

  const currentHumanDistance = distanceToGoal(room.game, HUMAN_PLAYER_ID);
  const currentAiDistance = distanceToGoal(room.game, AI_PLAYER_ID);
  const ai = room.game.players[AI_PLAYER_ID].position;
  const human = room.game.players[HUMAN_PLAYER_ID].position;
  const nearbyOnly = difficulty !== "pro";
  let best: { wall: Wall; score: number } | null = null;

  for (const wall of wallCandidates(room.game)) {
    if (nearbyOnly && Math.abs(wall.row - human.row) + Math.abs(wall.col - human.col) > 4) continue;

    const testGame = cloneGame(room.game);
    const result = applyWallPlacement(testGame, { roomId: room.id, playerId: AI_PLAYER_ID, wall });
    if (!result.ok) continue;

    const humanDistance = distanceToGoal(testGame, HUMAN_PLAYER_ID);
    const aiDistance = distanceToGoal(testGame, AI_PLAYER_ID);
    const blocksHuman = humanDistance - currentHumanDistance;
    const hurtsAi = aiDistance - currentAiDistance;
    const nearHuman = Math.max(0, 5 - (Math.abs(wall.row - human.row) + Math.abs(wall.col - human.col))) * 0.18;
    const shieldsAi = Math.max(0, 4 - (Math.abs(wall.row - ai.row) + Math.abs(wall.col - ai.col))) * 0.08;
    const precision = difficulty === "pro" ? 0.02 : difficulty === "hard" ? 0.18 : 0.5;
    const score = blocksHuman * 2.4 - hurtsAi * 1.45 + nearHuman - shieldsAi + Math.random() * precision;

    if (!best || score > best.score) best = { wall, score };
  }

  const minimumScore = difficulty === "pro" ? 0.35 : difficulty === "hard" ? 0.65 : 1.1;
  return best && best.score >= minimumScore ? best.wall : null;
}

function aiWallChance(difficulty: AiDifficulty): number {
  if (difficulty === "easy") return 0.08;
  if (difficulty === "normal") return 0.34;
  if (difficulty === "hard") return 0.62;
  return 0.9;
}

function scheduleAiTurn(room: NonNullable<ReturnType<typeof getRoom>>): void {
  clearAiTimeout(room);
  if (room.game.matchType !== "ai" || room.game.status !== "playing" || room.game.currentTurn !== AI_PLAYER_ID) return;

  room.aiTimeout = setTimeout(() => {
    const latestRoom = getRoom(room.id);
    if (!latestRoom || latestRoom.game.matchType !== "ai" || latestRoom.game.status !== "playing" || latestRoom.game.currentTurn !== AI_PLAYER_ID) return;

    if (syncClockElapsed(latestRoom)) {
      emitRoomUpdate(latestRoom);
      return;
    }

    const difficulty = latestRoom.aiDifficulty ?? latestRoom.game.aiDifficulty ?? "normal";
    const legalMoves = getLegalPawnMoves(latestRoom.game, AI_PLAYER_ID);
    const winningMove = legalMoves.find((move) => move.row === goalRowFor(AI_PLAYER_ID, latestRoom.game));
    const shouldTryWall = !winningMove && Math.random() < aiWallChance(difficulty);
    const nextWall = shouldTryWall ? bestAiWall(latestRoom, difficulty) : null;
    const nextMove = winningMove ?? legalMoves.sort((a, b) => aiMoveScore(latestRoom, a, difficulty) - aiMoveScore(latestRoom, b, difficulty))[0];

    if (nextWall) {
      const result = applyWallPlacement(latestRoom.game, { roomId: latestRoom.id, playerId: AI_PLAYER_ID, wall: nextWall });
      if (!result.ok) return;
    } else if (nextMove) {
      const result = applyPawnMove(latestRoom.game, { roomId: latestRoom.id, playerId: AI_PLAYER_ID, to: nextMove });
      if (!result.ok) return;
    } else {
      const result = applyTurnTimeout(latestRoom.game, AI_PLAYER_ID);
      if (!result.ok) return;
    }

    clearRematch(latestRoom);
    if (!latestRoom.game.winner) {
      addClockIncrement(latestRoom, AI_PLAYER_ID);
      resetTurnClock(latestRoom);
      scheduleTurnTimeout(latestRoom);
    } else {
      clearTurnTimeout(latestRoom);
    }
    emitRoomUpdate(latestRoom);
  }, 550 + Math.floor(Math.random() * 650));
}

const app = express();
const allowedOrigins = Array.from(new Set([
  "http://localhost:5173",
  "https://buruuzam.web.app",
  "https://buruuzam.firebaseapp.com",
  CLIENT_URL
]));

app.use(cors({
  origin: allowedOrigins
}));
app.use(express.json());

app.get("/", (_req, res) => res.send("Wallz MN backend is running"));
app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/leaderboard", async (req, res) => {
  try {
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 50;
    const decoded = req.headers.authorization ? await verifyBearerToken(req.headers.authorization).catch(() => null) : null;
    res.json({
      players: await getLeaderboard(limit),
      currentPlayer: decoded ? await getLeaderboardRank(decoded.uid) : null,
    });
  } catch {
    res.status(500).json({ error: "Could not load leaderboard." });
  }
});

app.get("/me/history", async (req, res) => {
  try {
    const decoded = await verifyBearerToken(req.headers.authorization);
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 8;
    res.json({ matches: await getUserMatchHistory(decoded.uid, limit) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Could not load match history." });
  }
});

app.post("/ranked/enqueue", async (req, res) => {
  try {
    const decoded = await verifyBearerToken(req.headers.authorization);
    const { timeControlId } = req.body as { timeControlId?: TimeControlId };
    res.json(await enqueueRanked(decoded, timeControlId));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Could not enter ranked queue." });
  }
});

app.post("/ranked/cancel", async (req, res) => {
  try {
    const decoded = await verifyBearerToken(req.headers.authorization);
    res.json(await cancelRanked(decoded));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Could not cancel ranked queue." });
  }
});

app.get("/ranked/status", async (req, res) => {
  try {
    const decoded = await verifyBearerToken(req.headers.authorization);
    res.json(await getRankedStatus(decoded));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Could not read ranked status." });
  }
});

app.post("/ranked/finalize", async (req, res) => {
  try {
    const decoded = await verifyBearerToken(req.headers.authorization);
    const { matchId, winnerUid, loserUid, moveHistory } = req.body as { matchId?: string; winnerUid?: string; loserUid?: string; moveHistory?: unknown };
    if (!matchId || !winnerUid || !loserUid) throw new Error("Missing ranked result.");
    res.json(await finalizeRankedMatch(decoded, matchId, winnerUid, loserUid, { moveHistory: Array.isArray(moveHistory) ? moveHistory : [] }));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Could not finalize ranked match." });
  }
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"]
  }
});

const casualQueue = new Map<string, CasualQueueEntry>();

function emitPresenceCount(): void {
  io.emit("presence-count", {
    online: io.engine.clientsCount,
    playing: activeHumanPlayerCount(),
  });
}

io.on("connection", (socket) => {
  console.log("connected", socket.id);
  emitPresenceCount();

  socket.on("create-room", ({ profile, timeControlId }: { profile?: ClientPlayerProfile; timeControlId?: TimeControlId } = {}) => {
    const room = createRoom(socket.id, profile, timeControlId);
    socket.join(room.id);
    socket.emit("room-created", { roomId: room.id, playerId: "P1", game: room.game });
    emitPresenceCount();
  });

  socket.on("create-ai-room", ({ profile, difficulty, timeControlId }: { profile?: ClientPlayerProfile; difficulty?: AiDifficulty; timeControlId?: TimeControlId } = {}) => {
    const allowedDifficulty: AiDifficulty = difficulty === "easy" || difficulty === "normal" || difficulty === "hard" || difficulty === "pro" ? difficulty : "normal";
    const room = createAiRoom(socket.id, profile, allowedDifficulty, timeControlId);
    resetTurnClock(room);
    socket.join(room.id);
    socket.emit("game-started", { roomId: room.id, playerId: "P1", game: room.game });
    io.to(room.id).emit("game-updated", room.game);
    scheduleTurnTimeout(room);
    scheduleAiTurn(room);
    emitPresenceCount();
  });

  socket.on("join-room", ({ roomId, profile }: { roomId: string; profile?: ClientPlayerProfile }) => {
    const result = joinRoom(roomId, socket.id, profile);
    if (!result.room || !result.playerId) {
      socket.emit("invalid-move", { message: result.error ?? "Could not join room." });
      return;
    }

    socket.join(result.room.id);
    if (result.room.game.status === "playing") {
      resetTurnClock(result.room);
    }
    socket.emit("game-started", {
      roomId: result.room.id,
      playerId: result.playerId,
      game: result.room.game,
    });

    io.to(result.room.id).emit("game-updated", result.room.game);
    if (result.room.game.status === "playing") {
      scheduleTurnTimeout(result.room);
    }
    emitPresenceCount();
  });

  socket.on("rejoin-room", async ({ roomId, playerId, profile, idToken }: { roomId: string; playerId: PlayerId; profile?: ClientPlayerProfile; idToken?: string }) => {
    try {
      const uid = idToken ? (await verifyBearerToken(`Bearer ${idToken}`)).uid : undefined;
      const result = rejoinRoom(roomId, playerId, socket.id, profile, uid);
      if (!result.room || !result.playerId) {
        socket.emit("invalid-move", { message: result.error ?? "Could not rejoin room." });
        return;
      }

      if (result.room.sockets.P1 && result.room.sockets.P2 && result.room.game.status === "playing") {
        resetTurnClock(result.room);
      }
      socket.join(result.room.id);
      socket.emit("game-started", {
        roomId: result.room.id,
        playerId: result.playerId,
        game: result.room.game,
      });
      io.to(result.room.id).emit("opponent-reconnected", { message: "Opponent reconnected." });
      io.to(result.room.id).emit("game-updated", result.room.game);
      scheduleTurnTimeout(result.room);
      scheduleAiTurn(result.room);
      emitPresenceCount();
    } catch (err) {
      socket.emit("invalid-move", { message: err instanceof Error ? err.message : "Could not rejoin room." });
    }
  });

  socket.on("join-ranked-match", async ({ matchId, idToken }: { matchId: string; idToken: string }) => {
    try {
      const decoded = await verifyBearerToken(`Bearer ${idToken}`);
      const match = await getRankedMatch(matchId);
      if (!match || match.status !== "active") {
        socket.emit("invalid-move", { message: "Ranked match is not active." });
        return;
      }

      const result = connectRankedRoom(matchId, match.players, decoded.uid, socket.id, match.timeControlId);
      if (!result.room || !result.playerId) {
        socket.emit("invalid-move", { message: result.error ?? "Could not join ranked match." });
        return;
      }

      socket.join(result.room.id);
      socket.emit("game-started", {
        roomId: result.room.id,
        playerId: result.playerId,
        game: result.room.game,
      });
      io.to(result.room.id).emit("game-updated", result.room.game);
      scheduleTurnTimeout(result.room);
      emitPresenceCount();
    } catch (err) {
      socket.emit("invalid-move", { message: err instanceof Error ? err.message : "Could not join ranked match." });
    }
  });

  socket.on("casual-search", ({ profile, timeControlId }: { profile?: ClientPlayerProfile; timeControlId?: TimeControlId } = {}) => {
    if (casualQueue.has(socket.id)) return;
    const selectedTimeControl = resolveTimeControl(timeControlId);

    const opponent = [...casualQueue.values()].find((entry) => entry.socketId !== socket.id && entry.timeControlId === selectedTimeControl.id);
    if (!opponent) {
      casualQueue.set(socket.id, { socketId: socket.id, profile, timeControlId: selectedTimeControl.id });
      socket.emit("casual-searching");
      return;
    }

    casualQueue.delete(opponent.socketId);
    const opponentSocket = io.sockets.sockets.get(opponent.socketId);
    if (!opponentSocket) {
      casualQueue.set(socket.id, { socketId: socket.id, profile, timeControlId: selectedTimeControl.id });
      socket.emit("casual-searching");
      return;
    }

    const room = createCasualRoom(opponent.socketId, socket.id, opponent.profile, profile, selectedTimeControl.id);
    resetTurnClock(room);
    opponentSocket.join(room.id);
    socket.join(room.id);
    opponentSocket.emit("game-started", { roomId: room.id, playerId: "P1", game: room.game });
    socket.emit("game-started", { roomId: room.id, playerId: "P2", game: room.game });
    io.to(room.id).emit("game-updated", room.game);
    scheduleTurnTimeout(room);
    emitPresenceCount();
  });

  socket.on("casual-cancel", () => {
    casualQueue.delete(socket.id);
    socket.emit("casual-cancelled");
  });

  socket.on("move-pawn", (payload: MovePawnPayload) => {
    const room = getRoom(payload.roomId);
    if (!room) {
      socket.emit("invalid-move", { message: "Room not found." });
      return;
    }
    if (!isSeatedPlayer(room, payload.playerId, socket.id)) {
      socket.emit("invalid-move", { message: "You are not seated as this player." });
      return;
    }

    if (syncClockElapsed(room)) {
      emitRoomUpdate(room);
      return;
    }

    const result = applyPawnMove(room.game, payload);
    if (!result.ok) {
      socket.emit("invalid-move", { message: result.message });
      return;
    }

    clearRematch(room);
    if (!room.game.winner) {
      addClockIncrement(room, payload.playerId);
      resetTurnClock(room);
      scheduleTurnTimeout(room);
    } else {
      clearTurnTimeout(room);
    }
    emitRoomUpdate(room);
    scheduleAiTurn(room);
  });

  socket.on("place-wall", (payload: PlaceWallPayload) => {
    const room = getRoom(payload.roomId);
    if (!room) {
      socket.emit("invalid-move", { message: "Room not found." });
      return;
    }
    if (!isSeatedPlayer(room, payload.playerId, socket.id)) {
      socket.emit("invalid-move", { message: "You are not seated as this player." });
      return;
    }

    if (syncClockElapsed(room)) {
      emitRoomUpdate(room);
      return;
    }

    const result = applyWallPlacement(room.game, payload);
    if (!result.ok) {
      socket.emit("invalid-move", { message: result.message });
      return;
    }

    clearRematch(room);
    addClockIncrement(room, payload.playerId);
    resetTurnClock(room);
    scheduleTurnTimeout(room);
    emitRoomUpdate(room);
    scheduleAiTurn(room);
  });

  socket.on("give-up", (payload: GiveUpPayload) => {
    const room = getRoom(payload.roomId);
    if (!room) {
      socket.emit("invalid-move", { message: "Room not found." });
      return;
    }
    if (!isSeatedPlayer(room, payload.playerId, socket.id)) {
      socket.emit("invalid-move", { message: "You are not seated as this player." });
      return;
    }

    const result = applyGiveUp(room.game, payload);
    if (!result.ok) {
      socket.emit("invalid-move", { message: result.message });
      return;
    }

    clearRematch(room);
    clearTurnTimeout(room);
    emitRoomUpdate(room);
  });

  socket.on("send-chat-message", (payload: SendChatMessagePayload) => {
    const room = getRoom(payload.roomId);
    if (!room) {
      socket.emit("invalid-move", { message: "Room not found." });
      return;
    }

    if (room.sockets[payload.playerId] !== socket.id) {
      socket.emit("invalid-move", { message: "You are not seated in this room." });
      return;
    }

    const text = payload.text.trim().replace(/\s+/g, " ").slice(0, MAX_CHAT_LENGTH);
    if (!text) return;

    const message: ChatMessage = {
      id: `${Date.now()}-${socket.id}`,
      roomId: room.id,
      playerId: payload.playerId,
      senderName: room.game.players[payload.playerId].name,
      text,
      createdAt: Date.now(),
    };

    room.game.chatMessages = [...(room.game.chatMessages ?? []), message].slice(-MAX_CHAT_MESSAGES);
    io.to(room.id).emit("chat-message", message);
    io.to(room.id).emit("game-updated", room.game);
  });

  socket.on("request-rematch", (payload: RematchPayload) => {
    const room = getRoom(payload.roomId);
    if (!room || room.game.status !== "finished") {
      socket.emit("rematch-declined", { message: "Rematch is not available." });
      return;
    }

    const opponent = otherPlayer(payload.playerId);
    const opponentSocketId = room.sockets[opponent];
    if (!opponentSocketId) {
      socket.emit("rematch-declined", { message: "Opponent left the game." });
      return;
    }

    if (room.rematch && room.rematch.requester !== payload.playerId) {
      const nextRoom = createRematchRoom(room);
      resetTurnClock(nextRoom);
      for (const id of Object.values(nextRoom.sockets)) {
        if (id) {
          const playerSocket = io.sockets.sockets.get(id);
          playerSocket?.leave(room.id);
          playerSocket?.join(nextRoom.id);
        }
      }
      for (const [nextPlayerId, id] of Object.entries(nextRoom.sockets)) {
        if (id) {
          io.to(id).emit("rematch-started", { roomId: nextRoom.id, playerId: nextPlayerId, game: nextRoom.game });
        }
      }
      io.to(nextRoom.id).emit("game-updated", nextRoom.game);
      scheduleTurnTimeout(nextRoom);
      return;
    }

    clearRematch(room);
    const expiresAt = Date.now() + REMATCH_MS;
    room.rematch = {
      requester: payload.playerId,
      expiresAt,
      timeout: setTimeout(() => {
        const latestRoom = getRoom(room.id);
        if (!latestRoom?.rematch || latestRoom.rematch.requester !== payload.playerId) return;
        const requesterSocketId = latestRoom.sockets[payload.playerId];
        if (requesterSocketId) io.to(requesterSocketId).emit("rematch-declined", { message: "No response." });
        clearRematch(latestRoom);
      }, REMATCH_MS),
    };

    socket.emit("rematch-waiting", { expiresAt });
    io.to(opponentSocketId).emit("rematch-requested", {
      fromPlayerId: payload.playerId,
      fromName: room.game.players[payload.playerId].name,
      expiresAt,
    });
  });

  socket.on("accept-rematch", (payload: RematchPayload) => {
    const room = getRoom(payload.roomId);
    if (!room || !room.rematch) {
      socket.emit("rematch-declined", { message: "Rematch request expired." });
      return;
    }

    const requester = room.rematch.requester;
    if (payload.playerId === requester) return;

    const nextRoom = createRematchRoom(room);
    resetTurnClock(nextRoom);
    for (const id of Object.values(nextRoom.sockets)) {
      if (id) {
        const playerSocket = io.sockets.sockets.get(id);
        playerSocket?.leave(room.id);
        playerSocket?.join(nextRoom.id);
      }
    }

    for (const [nextPlayerId, id] of Object.entries(nextRoom.sockets)) {
      if (id) {
        io.to(id).emit("rematch-started", { roomId: nextRoom.id, playerId: nextPlayerId, game: nextRoom.game });
      }
    }
    io.to(nextRoom.id).emit("game-updated", nextRoom.game);
    scheduleTurnTimeout(nextRoom);
  });

  socket.on("decline-rematch", (payload: RematchPayload) => {
    const room = getRoom(payload.roomId);
    if (!room?.rematch) return;
    const requesterSocketId = room.sockets[room.rematch.requester];
    if (requesterSocketId) io.to(requesterSocketId).emit("rematch-declined", { message: "Declined." });
    clearRematch(room);
  });

  socket.on("disconnect", () => {
    casualQueue.delete(socket.id);
    const active = findSocketRoom(socket.id);
    if (active?.room.game.status === "playing") {
      const room = active.room;
      const leavingPlayer = active.playerId;
      const remainingPlayer: PlayerId = leavingPlayer === "P1" ? "P2" : "P1";
      const remainingSocketId = room.sockets[remainingPlayer];
      const endsAt = Date.now() + ABANDONMENT_MS;

      clearPlayerDisconnect(room, leavingPlayer);
      room.sockets[leavingPlayer] = undefined;
      if (!room.disconnected) room.disconnected = {};
      if (room.game.clocks) {
        room.game.clocks.disconnectedPlayer = leavingPlayer;
        room.game.clocks.disconnectEndsAt = endsAt;
      }
      if (remainingSocketId) {
        io.to(remainingSocketId).emit("opponent-disconnected", {
          message: "Enemy left. Waiting for reconnect...",
          endsAt,
        });
        io.to(remainingSocketId).emit("game-updated", room.game);
      }

      room.disconnected[leavingPlayer] = {
        endsAt,
        timeout: setTimeout(() => {
          const latestRoom = getRoom(room.id);
          if (!latestRoom || latestRoom.sockets[leavingPlayer] || latestRoom.game.status !== "playing") return;

          const latestRemainingSocketId = latestRoom.sockets[remainingPlayer];
          finishGame(latestRoom.game, remainingPlayer, "abandoned");
          clearPlayerDisconnect(latestRoom, leavingPlayer);
          clearRematch(latestRoom);
          clearTurnTimeout(latestRoom);

          if (latestRemainingSocketId) {
            io.to(latestRemainingSocketId).emit("game-updated", latestRoom.game);
            io.to(latestRemainingSocketId).emit("game-over", latestRoom.game);
            io.to(latestRemainingSocketId).emit("match-abandoned", {
              message: "Enemy left and lost by abandonment.",
            });
          }
          emitPresenceCount();
        }, ABANDONMENT_MS),
      };

      console.log("disconnected", socket.id);
      emitPresenceCount();
      return;
    }

    removeSocketFromRooms(socket.id);
    console.log("disconnected", socket.id);
    emitPresenceCount();
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
