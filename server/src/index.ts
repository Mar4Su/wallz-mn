import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import {
  clearRematch,
  createRematchRoom,
  createRoom,
  getRoom,
  joinRoom,
  otherPlayer,
  removeSocketFromRooms,
} from "./game/rooms";
import { applyGiveUp, applyPawnMove, applyWallPlacement } from "./game/rules";
import type { GiveUpPayload, MovePawnPayload, PlaceWallPayload, RematchPayload } from "../../shared/types";

const PORT = Number(process.env.PORT ?? 4000);
const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";
const REMATCH_MS = 10_000;

const app = express();
const allowedOrigins = [
  "http://localhost:5173",
  "https://buruuzam.web.app",
  "https://buruuzam.firebaseapp.com"
];

app.use(cors({
  origin: allowedOrigins
}));

app.get("/", (_req, res) => res.send("Wallz MN backend is running"));
app.get("/health", (_req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"]
  }
});

io.on("connection", (socket) => {
  console.log("connected", socket.id);

  socket.on("create-room", () => {
    const room = createRoom(socket.id);
    socket.join(room.id);
    socket.emit("room-created", { roomId: room.id, playerId: "P1", game: room.game });
  });

  socket.on("join-room", ({ roomId }: { roomId: string }) => {
    const result = joinRoom(roomId, socket.id);
    if (!result.room || !result.playerId) {
      socket.emit("invalid-move", { message: result.error ?? "Could not join room." });
      return;
    }

    socket.join(result.room.id);
    socket.emit("game-started", {
      roomId: result.room.id,
      playerId: result.playerId,
      game: result.room.game,
    });

    io.to(result.room.id).emit("game-updated", result.room.game);
  });

  socket.on("move-pawn", (payload: MovePawnPayload) => {
    const room = getRoom(payload.roomId);
    if (!room) {
      socket.emit("invalid-move", { message: "Room not found." });
      return;
    }

    const result = applyPawnMove(room.game, payload);
    if (!result.ok) {
      socket.emit("invalid-move", { message: result.message });
      return;
    }

    clearRematch(room);
    io.to(room.id).emit("game-updated", room.game);
    if (room.game.winner) io.to(room.id).emit("game-over", room.game);
  });

  socket.on("place-wall", (payload: PlaceWallPayload) => {
    const room = getRoom(payload.roomId);
    if (!room) {
      socket.emit("invalid-move", { message: "Room not found." });
      return;
    }

    const result = applyWallPlacement(room.game, payload);
    if (!result.ok) {
      socket.emit("invalid-move", { message: result.message });
      return;
    }

    clearRematch(room);
    io.to(room.id).emit("game-updated", room.game);
  });

  socket.on("give-up", (payload: GiveUpPayload) => {
    const room = getRoom(payload.roomId);
    if (!room) {
      socket.emit("invalid-move", { message: "Room not found." });
      return;
    }

    const result = applyGiveUp(room.game, payload);
    if (!result.ok) {
      socket.emit("invalid-move", { message: result.message });
      return;
    }

    clearRematch(room);
    io.to(room.id).emit("game-updated", room.game);
    io.to(room.id).emit("game-over", room.game);
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
  });

  socket.on("decline-rematch", (payload: RematchPayload) => {
    const room = getRoom(payload.roomId);
    if (!room?.rematch) return;
    const requesterSocketId = room.sockets[room.rematch.requester];
    if (requesterSocketId) io.to(requesterSocketId).emit("rematch-declined", { message: "Declined." });
    clearRematch(room);
  });

  socket.on("disconnect", () => {
    removeSocketFromRooms(socket.id);
    console.log("disconnected", socket.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
