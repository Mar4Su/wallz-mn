import { useEffect, useState } from "react";
import type { GameState, PlayerId } from "../../shared/types";
import { socket } from "./socket";
import Home from "./pages/Home";
import Game from "./pages/Game";

export default function App() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<PlayerId | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    socket.on("room-created", ({ roomId, playerId, game }) => {
      setRoomId(roomId);
      setPlayerId(playerId);
      setGame(game);
      setError(null);
    });

    socket.on("game-started", ({ roomId, playerId, game }) => {
      setRoomId(roomId);
      setPlayerId(playerId);
      setGame(game);
      setError(null);
    });

    socket.on("game-updated", (nextGame: GameState) => {
      setGame(nextGame);
      setError(null);
    });

    socket.on("invalid-move", ({ message }) => {
      setError(message ?? "Алдаа гарлаа.");
    });

    socket.on("game-over", (finalGame: GameState) => {
      setGame(finalGame);
    });

    return () => {
      socket.off("room-created");
      socket.off("game-started");
      socket.off("game-updated");
      socket.off("invalid-move");
      socket.off("game-over");
    };
  }, []);

  if (!roomId || !playerId || !game) {
    return <Home error={error} />;
  }

  return <Game roomId={roomId} playerId={playerId} game={game} error={error} />;
}
