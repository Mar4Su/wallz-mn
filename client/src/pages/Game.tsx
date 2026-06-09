import type { GameState, Orientation, PlayerId, Position, Wall } from "../../../shared/types";
import Board from "../components/Board";
import GameStatus from "../components/GameStatus";
import { socket } from "../socket";
import { t } from "../i18n";
import { useEffect, useState } from "react";

type Props = {
  roomId: string;
  playerId: PlayerId;
  game: GameState;
  error: string | null;
};

type DragPoint = { x: number; y: number } | null;

function wallFromPoint(x: number, y: number): Wall | null {
  const element = document.elementFromPoint(x, y);
  const hotspot = element?.closest<HTMLElement>(".wall-hotspot");
  if (!hotspot) return null;

  const row = Number(hotspot.dataset.wallRow);
  const col = Number(hotspot.dataset.wallCol);
  const orientation = hotspot.dataset.orientation as Orientation | undefined;

  if (!Number.isInteger(row) || !Number.isInteger(col) || (orientation !== "H" && orientation !== "V")) {
    return null;
  }

  return { row, col, orientation };
}

export default function Game({ roomId, playerId, game, error }: Props) {
  const [draggedWall, setDraggedWall] = useState<Orientation | null>(null);
  const [dragPoint, setDragPoint] = useState<DragPoint>(null);
  const isMyTurn = game.status === "playing" && game.currentTurn === playerId;
  const [showMatchIntro, setShowMatchIntro] = useState(game.status === "playing");

  function onCellClick(position: Position) {
    if (!isMyTurn) return;
    socket.emit("move-pawn", { roomId, playerId, to: position });
  }

  function onWallClick(wall: Wall) {
    if (!isMyTurn) return;
    socket.emit("place-wall", { roomId, playerId, wall });
  }

  function startWallDrag(orientation: Orientation, event: React.PointerEvent<HTMLButtonElement>) {
    if (!isMyTurn) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDraggedWall(orientation);
    setDragPoint({ x: event.clientX, y: event.clientY });
  }

  useEffect(() => {
    if (!draggedWall) return;

    function handlePointerMove(event: PointerEvent) {
      event.preventDefault();
      setDragPoint({ x: event.clientX, y: event.clientY });
    }

    function handlePointerUp(event: PointerEvent) {
      event.preventDefault();
      const wall = wallFromPoint(event.clientX, event.clientY);
      if (wall && wall.orientation === draggedWall && isMyTurn) {
        onWallClick(wall);
      }
      setDraggedWall(null);
      setDragPoint(null);
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp, { passive: false });
    window.addEventListener("pointercancel", handlePointerUp, { passive: false });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [draggedWall, isMyTurn, roomId, playerId]);

  useEffect(() => {
    if (!isMyTurn) {
      setDraggedWall(null);
      setDragPoint(null);
    }
  }, [isMyTurn]);

  useEffect(() => {
    if (game.status !== "playing") {
      setShowMatchIntro(false);
      return;
    }

    setShowMatchIntro(true);
    const timer = window.setTimeout(() => setShowMatchIntro(false), 2200);
    return () => window.clearTimeout(timer);
  }, [game.status, roomId]);

  const opponentId = playerId === "P1" ? "P2" : "P1";

  return (
    <main className={`game-page playing-game ${isMyTurn ? "turn-active" : "turn-waiting"}`}>
      <section className="top-bar">
        <div>
          <p className="eyebrow">{game.status === "playing" ? t.playing : t.waiting}</p>
          <h1>{t.title}</h1>
          <p>
            {t.roomCode}: <strong>{roomId}</strong> · {t.copyCode}
          </p>
        </div>
        <GameStatus game={game} playerId={playerId} />
      </section>

      {game.status === "waiting" && (
        <section className="waiting-overlay">
          <div className="waiting-card">
            <p className="waiting-label">{t.waiting}</p>
            <h2>{roomId}</h2>
            <p>{t.waitingFriendCode}</p>
            <button
              className="copy-button"
              onClick={() => {
                void navigator.clipboard?.writeText(roomId);
              }}
            >
              {t.copyRoomCode}
            </button>
          </div>
        </section>
      )}

      {showMatchIntro && game.status === "playing" && (
        <section className="match-intro-overlay" onClick={() => setShowMatchIntro(false)}>
          <div className="versus-card">
            <div className="intro-player intro-you">
              <div className="intro-avatar blue-avatar">●</div>
              <span className="intro-label">{t.you}</span>
              <strong>{playerId === "P1" ? t.p1 : t.p2}</strong>
              <small>ELO 1200 · 0W 0L</small>
            </div>
            <div className="intro-vs">VS</div>
            <div className="intro-player intro-opponent">
              <div className="intro-avatar red-avatar">●</div>
              <span className="intro-label">{t.opponent}</span>
              <strong>{opponentId === "P1" ? t.p1 : t.p2}</strong>
              <small>ELO 1200 · 0W 0L</small>
            </div>
          </div>
          <p className="intro-skip">{t.tapToSkip}</p>
        </section>
      )}

      {error && <p className="error-text">{error}</p>}

      <section className="play-layout">
        <Board
          game={game}
          playerId={playerId}
          draggedWall={draggedWall}
          dragPoint={dragPoint}
          onCellClick={onCellClick}
          onWallClick={onWallClick}
        />

        <aside className="side-panel">
          <section className="player-card opponent-card">
            <span className="player-label">{t.opponent}</span>
            <strong>{opponentId === "P1" ? t.p1 : t.p2}</strong>
            <span>
              {t.wallsLeft}: {game.players[opponentId].wallsLeft}
            </span>
          </section>

          <section className="wall-tray" aria-label="Wall tray">
            <p>{t.dragWalls}</p>
            <div className="wall-tray-buttons">
              <button
                className={`wall-card ${draggedWall === "H" ? "dragging" : ""}`}
                onPointerDown={(event) => startWallDrag("H", event)}
                disabled={!isMyTurn}
              >
                <span className="tray-wall horizontal" />
                <span>{t.wallHMode}</span>
              </button>

              <button
                className={`wall-card ${draggedWall === "V" ? "dragging" : ""}`}
                onPointerDown={(event) => startWallDrag("V", event)}
                disabled={!isMyTurn}
              >
                <span className="tray-wall vertical" />
                <span>{t.wallVMode}</span>
              </button>
            </div>
          </section>

          <section className="player-card you-card">
            <span className="player-label">{t.you}</span>
            <strong>{playerId === "P1" ? t.p1 : t.p2}</strong>
            <span>
              {t.wallsLeft}: {game.players[playerId].wallsLeft}
            </span>
          </section>
        </aside>
      </section>

      {draggedWall && dragPoint && (
        <div
          className={`drag-ghost-wall ${draggedWall === "H" ? "horizontal" : "vertical"}`}
          style={{ left: dragPoint.x, top: dragPoint.y }}
        />
      )}
    </main>
  );
}
