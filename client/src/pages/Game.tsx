import type { GameState, Orientation, PlayerColor, PlayerId, Position, Wall } from "../../../shared/types";
import Board from "../components/Board";
import { socket } from "../socket";
import { t } from "../i18n";
import { useEffect, useMemo, useState } from "react";

type Props = {
  roomId: string;
  playerId: PlayerId;
  game: GameState;
  error: string | null;
  onGoHome: () => void;
};

type RematchState =
  | { status: "idle" }
  | { status: "waiting"; expiresAt: number }
  | { status: "requested"; fromPlayerId: PlayerId; fromName: string; expiresAt: number }
  | { status: "declined"; message: string };

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

function oppositePlayer(playerId: PlayerId): PlayerId {
  return playerId === "P1" ? "P2" : "P1";
}

function colorName(color: PlayerColor): string {
  return color === "blue" ? t.blue : t.red;
}

export default function Game({ roomId, playerId, game, error, onGoHome }: Props) {
  const [draggedWall, setDraggedWall] = useState<Orientation | null>(null);
  const [dragPoint, setDragPoint] = useState<DragPoint>(null);
  const [showMatchIntro, setShowMatchIntro] = useState(game.status === "playing");
  const [confirmGiveUp, setConfirmGiveUp] = useState(false);
  const [rematch, setRematch] = useState<RematchState>({ status: "idle" });
  const [now, setNow] = useState(() => Date.now());

  const isMyTurn = game.status === "playing" && game.currentTurn === playerId;
  const opponentId = oppositePlayer(playerId);
  const myColor = game.players[playerId].color;
  const opponentColor = game.players[opponentId].color;
  const currentPlayer = game.players[game.currentTurn];
  const recentMoves = useMemo(() => [...(game.moveHistory ?? [])].slice(-8), [game.moveHistory]);
  const didWin = game.status === "finished" && game.winner === playerId;
  const myElo = game.result?.elo?.[playerId];
  const opponentElo = game.result?.elo?.[opponentId];
  const countdown = rematch.status === "waiting" || rematch.status === "requested" ? Math.max(0, Math.ceil((rematch.expiresAt - now) / 1000)) : 0;

  function onCellClick(position: Position) {
    if (!isMyTurn) return;
    setConfirmGiveUp(false);
    socket.emit("move-pawn", { roomId, playerId, to: position });
  }

  function onWallClick(wall: Wall) {
    if (!isMyTurn) return;
    setConfirmGiveUp(false);
    socket.emit("place-wall", { roomId, playerId, wall });
  }

  function onGiveUpClick() {
    if (game.status !== "playing") return;
    if (!confirmGiveUp) {
      setConfirmGiveUp(true);
      return;
    }
    socket.emit("give-up", { roomId, playerId });
  }


  function requestRematch() {
    if (game.status !== "finished" || rematch.status === "waiting") return;
    socket.emit("request-rematch", { roomId, playerId });
  }

  function acceptRematch() {
    socket.emit("accept-rematch", { roomId, playerId });
    setRematch({ status: "idle" });
  }

  function declineRematch() {
    socket.emit("decline-rematch", { roomId, playerId });
    setRematch({ status: "idle" });
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
    setConfirmGiveUp(false);
  }, [game.currentTurn, game.moveHistory?.length, game.status]);

  useEffect(() => {
    if (game.status !== "playing") {
      setShowMatchIntro(false);
      return;
    }

    setShowMatchIntro(true);
    const timer = window.setTimeout(() => setShowMatchIntro(false), 2200);
    return () => window.clearTimeout(timer);
  }, [game.status, roomId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    function onRematchWaiting({ expiresAt }: { expiresAt: number }) {
      setRematch({ status: "waiting", expiresAt });
    }

    function onRematchRequested(payload: { fromPlayerId: PlayerId; fromName: string; expiresAt: number }) {
      setRematch({ status: "requested", ...payload });
    }

    function onRematchDeclined({ message }: { message: string }) {
      setRematch({ status: "declined", message: message || t.rematchDeclined });
      window.setTimeout(onGoHome, 3000);
    }

    function onRematchStarted() {
      setRematch({ status: "idle" });
      setShowMatchIntro(true);
    }

    socket.on("rematch-waiting", onRematchWaiting);
    socket.on("rematch-requested", onRematchRequested);
    socket.on("rematch-declined", onRematchDeclined);
    socket.on("rematch-started", onRematchStarted);

    return () => {
      socket.off("rematch-waiting", onRematchWaiting);
      socket.off("rematch-requested", onRematchRequested);
      socket.off("rematch-declined", onRematchDeclined);
      socket.off("rematch-started", onRematchStarted);
    };
  }, [onGoHome]);

  useEffect(() => {
    if ((rematch.status === "waiting" || rematch.status === "requested") && countdown <= 0) {
      if (rematch.status === "requested") setRematch({ status: "idle" });
    }
  }, [countdown, rematch.status]);

  return (
    <main className={`game-page playing-game ${isMyTurn ? "turn-active" : "turn-waiting"} ${myColor}-player`}>
      <section className="top-bar compact-top-bar">
        <div>
          <p className="eyebrow">{game.status === "playing" ? t.playing : t.waiting}</p>
          <h1>{t.title}</h1>
          <p>
            {t.roomCode}: <strong>{roomId}</strong> · {t.copyCode}
          </p>
        </div>
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
            <div className={`intro-player intro-you ${myColor}-intro`}>
              <div className={`intro-avatar ${myColor}-avatar`} />
              <span className="intro-label">{t.you}</span>
              <strong>{playerId === "P1" ? t.p1 : t.p2}</strong>
              <small>{colorName(myColor)} · ELO 1200 · 0W 0L</small>
            </div>
            <div className="intro-vs">VS</div>
            <div className={`intro-player intro-opponent ${opponentColor}-intro`}>
              <div className={`intro-avatar ${opponentColor}-avatar`} />
              <span className="intro-label">{t.opponent}</span>
              <strong>{opponentId === "P1" ? t.p1 : t.p2}</strong>
              <small>{colorName(opponentColor)} · ELO 1200 · 0W 0L</small>
            </div>
          </div>
          <p className="intro-skip">{t.tapToSkip}</p>
        </section>
      )}


      {game.status === "finished" && (
        <section className={`result-overlay ${didWin ? "win" : "lose"}`}>
          <div className="result-card">
            <div className="result-versus">
              <div className="result-player">
                <span className={`result-avatar ${myColor}`}>{game.players[playerId].avatar}</span>
                <strong>{game.players[playerId].name}</strong>
                <small>{myColor === "blue" ? t.blue : t.red}</small>
              </div>
              <div className="result-title-block">
                <p>{didWin ? t.winTitle : t.loseTitle}</p>
                <h2>{didWin ? "+" : ""}{myElo?.delta ?? 0} ELO</h2>
              </div>
              <div className="result-player">
                <span className={`result-avatar ${opponentColor}`}>{game.players[opponentId].avatar}</span>
                <strong>{game.players[opponentId].name}</strong>
                <small>{opponentColor === "blue" ? t.blue : t.red}</small>
              </div>
            </div>

            <div className="elo-grid">
              <div>
                <span>{t.you}</span>
                <strong>{myElo?.before ?? game.players[playerId].elo} → {myElo?.after ?? game.players[playerId].elo}</strong>
              </div>
              <div>
                <span>{t.opponent}</span>
                <strong>{opponentElo?.before ?? game.players[opponentId].elo} → {opponentElo?.after ?? game.players[opponentId].elo}</strong>
              </div>
            </div>

            {rematch.status === "requested" && (
              <div className="rematch-toast">
                <strong>{rematch.fromName}</strong> {t.rematchRequested}
                <span>{countdown}s</span>
                <div className="rematch-actions">
                  <button onClick={acceptRematch}>{t.accept}</button>
                  <button onClick={declineRematch}>{t.decline}</button>
                </div>
              </div>
            )}

            <div className="result-actions">
              <button
                className={`rematch-button ${rematch.status}`}
                onClick={requestRematch}
                disabled={rematch.status === "waiting" || rematch.status === "declined"}
              >
                {rematch.status === "waiting"
                  ? `${t.rematchCountdown} ${countdown}s`
                  : rematch.status === "declined"
                    ? t.rematchDeclined
                    : t.rematch}
              </button>
              <button className="home-button" onClick={onGoHome}>{t.goHome}</button>
            </div>
            {rematch.status === "declined" && <p className="auto-home-text">{t.autoHome}</p>}
          </div>
        </section>
      )}

      {error && <p className="error-text">{error}</p>}

      <section className="play-layout responsive-play-layout">
        <Board
          game={game}
          playerId={playerId}
          draggedWall={draggedWall}
          dragPoint={dragPoint}
          onCellClick={onCellClick}
          onWallClick={onWallClick}
        />

        <aside className="side-panel compact-side-panel">
          <section className="wall-tray compact-wall-tray" aria-label="Wall tray">
            <p>{t.dragWalls}</p>
            <div className="wall-tray-buttons">
              <button
                className={`wall-card ${myColor}-wall-card ${draggedWall === "H" ? "dragging" : ""}`}
                onPointerDown={(event) => startWallDrag("H", event)}
                disabled={!isMyTurn}
              >
                <span className={`tray-wall horizontal ${myColor}-tray-wall`} />
                <span>{t.wallHMode}</span>
              </button>

              <button
                className={`wall-card ${myColor}-wall-card ${draggedWall === "V" ? "dragging" : ""}`}
                onPointerDown={(event) => startWallDrag("V", event)}
                disabled={!isMyTurn}
              >
                <span className={`tray-wall vertical ${myColor}-tray-wall`} />
                <span>{t.wallVMode}</span>
              </button>
            </div>
          </section>

          <section className={`turn-card ${isMyTurn ? "my-turn-card" : "enemy-turn-card"}`}>
            <p className="turn-label">{game.status === "finished" ? t.gameFinished : isMyTurn ? t.yourTurn : t.opponentTurn}</p>
            <div className="turn-row">
              <span className={`mini-avatar ${currentPlayer.color}`} />
              <div>
                <strong>{game.currentTurn === playerId ? t.you : t.opponent}</strong>
                <small>{colorName(currentPlayer.color)} · {game.currentTurn === "P1" ? t.p1 : t.p2}</small>
              </div>
              <span className="wall-count">{currentPlayer.wallsLeft}</span>
            </div>
          </section>

          <section className="moves-panel compact-panel">
            <div className="panel-head">
              <span>{t.moves}</span>
              <strong>{game.moveHistory?.length ?? 0}</strong>
            </div>
            {recentMoves.length === 0 ? (
              <p className="empty-panel-text">{t.noMovesYet}</p>
            ) : (
              <ol className="moves-list">
                {recentMoves.map((move) => {
                  const color = game.players[move.playerId].color;
                  return (
                    <li key={`${move.turn}-${move.playerId}-${move.text}`}>
                      <span className={`move-color-dot ${color}`} />
                      <span>{move.text}</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <section className="chat-panel compact-panel">
            <div className="panel-head">
              <span>{t.chat}</span>
              <strong>{t.onlineOnly}</strong>
            </div>
            <p className="empty-panel-text">{t.chatComingSoon}</p>
          </section>

          <div className="action-row">
            <button className="ghost-button" disabled>{t.undo}</button>
            <button className={`give-up-button ${confirmGiveUp ? "confirm" : ""}`} onClick={onGiveUpClick} disabled={game.status !== "playing"}>
              {confirmGiveUp ? t.areYouSure : t.giveUp}
            </button>
          </div>
        </aside>
      </section>

      {draggedWall && dragPoint && (
        <div
          className={`drag-ghost-wall ${draggedWall === "H" ? "horizontal" : "vertical"} ${myColor}-ghost-wall`}
          style={{ left: dragPoint.x, top: dragPoint.y }}
        />
      )}
    </main>
  );
}
