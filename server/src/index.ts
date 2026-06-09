import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { createRoom, getRoom, joinRoom, removeSocketFromRooms } from "./game/rooms";
import { applyPawnMove, applyWallPlacement } from "./game/rules";
import type { MovePawnPayload, PlaceWallPayload } from "../../shared/types";

const PORT = Number(process.env.PORT ?? 4000);
const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

const app = express();
app.use(cors({ origin: CLIENT_URL }));
app.get("/health", (_req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_URL,
    methods: ["GET", "POST"],
  },
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

    io.to(room.id).emit("game-updated", room.game);
  });

  socket.on("disconnect", () => {
    removeSocketFromRooms(socket.id);
    console.log("disconnected", socket.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
