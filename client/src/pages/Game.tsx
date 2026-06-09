import type { GameState, PlayerId, Position, Wall } from "../../../shared/types";
import Board from "../components/Board";
import GameStatus from "../components/GameStatus";
import { socket } from "../socket";
import { t } from "../i18n";
import { useState } from "react";

type Mode = "move" | "wallH" | "wallV";

type Props = {
  roomId: string;
  playerId: PlayerId;
  game: GameState;
  error: string | null;
};

export default function Game({ roomId, playerId, game, error }: Props) {
  const [mode, setMode] = useState<Mode>("move");

  function onCellClick(position: Position) {
    if (mode !== "move") return;
    socket.emit("move-pawn", { roomId, playerId, to: position });
  }

  function onWallClick(wall: Omit<Wall, "orientation">) {
    if (mode === "move") return;
    socket.emit("place-wall", {
      roomId,
      playerId,
      wall: {
        ...wall,
        orientation: mode === "wallH" ? "H" : "V",
      },
    });
  }

  return (
    <main className="game-page">
      <section className="top-bar">
        <div>
          <h1>{t.title}</h1>
          <p>
            {t.roomCode}: <strong>{roomId}</strong> · {t.copyCode}
          </p>
        </div>
        <GameStatus game={game} playerId={playerId} />
      </section>

      <section className="mode-row">
        <button className={mode === "move" ? "active" : ""} onClick={() => setMode("move")}>
          {t.moveMode}
        </button>
        <button className={mode === "wallH" ? "active" : ""} onClick={() => setMode("wallH")}>
          {t.wallHMode}
        </button>
        <button className={mode === "wallV" ? "active" : ""} onClick={() => setMode("wallV")}>
          {t.wallVMode}
        </button>
      </section>

      {error && <p className="error-text">{error}</p>}

      <Board game={game} onCellClick={onCellClick} onWallClick={onWallClick} />
    </main>
  );
}
