import type { ChatMessage, GameState, Orientation, PlayerColor, PlayerId, Position, Wall } from "../../../shared/types";
import Board from "../components/Board";
import { socket } from "../socket";
import { t } from "../i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { animate, stagger } from "animejs";
import { useAuth } from "../auth/AuthContext";
import { updateMatchPresence } from "../auth/matchPresence";
import { finalizeRanked } from "../rankedApi";
import type { RankedFinalizeResponse } from "../rankedApi";
import { profilePictureUrl } from "../profilePictures";

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

function playerLabel(game: GameState, id: PlayerId): string {
  return game.players[id].name || (id === "P1" ? "Player 1" : "Player 2");
}

function playerSubLabel(game: GameState, id: PlayerId): string {
  const player = game.players[id];
  return player.publicId ? `@${player.publicId}` : id === "P1" ? "Player 1" : "Player 2";
}

function matchModeLabel(matchType: GameState["matchType"]): string {
  if (matchType === "ranked") return "Ranked";
  if (matchType === "casual") return "Casual";
  if (matchType === "ai") return "Computer";
  return "Friend";
}

function formatClock(ms: number): string {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.ceil(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function Game({ roomId, playerId, game, error, onGoHome }: Props) {
  const { currentUser, refreshProfile } = useAuth();
  const [draggedWall, setDraggedWall] = useState<Orientation | null>(null);
  const [dragPoint, setDragPoint] = useState<DragPoint>(null);
  const [showMatchIntro, setShowMatchIntro] = useState(game.status === "playing");
  const [confirmGiveUp, setConfirmGiveUp] = useState(false);
  const [rematch, setRematch] = useState<RematchState>({ status: "idle" });
  const [now, setNow] = useState(() => Date.now());
  const [rankedResult, setRankedResult] = useState<RankedFinalizeResponse | null>(null);
  const [chatText, setChatText] = useState("");
  const [showResultOverlay, setShowResultOverlay] = useState(game.status === "finished");
  const [boardIntroStaggerKey, setBoardIntroStaggerKey] = useState(0);
  const rankedFinalizeRef = useRef<string | null>(null);
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const introFinishedRef = useRef(false);

  const isMyTurn = game.status === "playing" && game.currentTurn === playerId;
  const opponentId = oppositePlayer(playerId);
  const myColor = game.players[playerId].color;
  const opponentColor = game.players[opponentId].color;
  const currentPlayer = game.players[game.currentTurn];
  const recentMoves = useMemo(() => [...(game.moveHistory ?? [])].slice(-8), [game.moveHistory]);
  const didWin = game.status === "finished" && game.winner === playerId;
  const rankedMySide = rankedResult && game.players[playerId].uid === rankedResult.winnerUid ? rankedResult.winner : rankedResult?.loser;
  const rankedOpponentSide = rankedResult && game.players[opponentId].uid === rankedResult.winnerUid ? rankedResult.winner : rankedResult?.loser;
  const myElo = rankedMySide ?? game.result?.elo?.[playerId];
  const opponentElo = rankedOpponentSide ?? game.result?.elo?.[opponentId];
  const countdown = rematch.status === "waiting" || rematch.status === "requested" ? Math.max(0, Math.ceil((rematch.expiresAt - now) / 1000)) : 0;
  const isRankedMatch = game.matchType === "ranked";
  const clocks = game.clocks;
  const elapsedTurnMs = game.status === "playing" && clocks ? Math.max(0, now - clocks.turnStartedAt) : 0;
  const playerClockMs = (id: PlayerId) => {
    const base = clocks?.totalMs[id] ?? 180_000;
    return id === game.currentTurn && game.status === "playing" ? base - elapsedTurnMs : base;
  };
  const turnClockMs = clocks && game.status === "playing" ? clocks.turnEndsAt - now : 0;
  const disconnectSeconds = clocks?.disconnectEndsAt ? Math.max(0, Math.ceil((clocks.disconnectEndsAt - now) / 1000)) : 0;
  const opponentDisconnected = clocks?.disconnectedPlayer === opponentId && disconnectSeconds > 0;
  const chatMessages = game.chatMessages ?? [];
  const handleWinAnimationComplete = useCallback(() => {
    setShowResultOverlay(true);
  }, []);
  const finishMatchIntro = useCallback(() => {
    if (introFinishedRef.current) return;
    introFinishedRef.current = true;
    setShowMatchIntro(false);
    setBoardIntroStaggerKey((key) => key + 1);
  }, []);

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

  function sendChatMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = chatText.trim();
    if (!text) return;
    socket.emit("send-chat-message", { roomId, playerId, text });
    setChatText("");
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
    introFinishedRef.current = false;
    const timer = window.setTimeout(finishMatchIntro, 2200);
    return () => window.clearTimeout(timer);
  }, [finishMatchIntro, game.status, roomId]);

  useEffect(() => {
    if (game.status !== "finished") {
      setShowResultOverlay(false);
      return;
    }

    setShowResultOverlay(false);
  }, [game.status, game.winner, roomId]);

  useEffect(() => {
    if (!showMatchIntro || game.status !== "playing") return undefined;
    const animations = [
      animate(".match-intro-overlay .intro-player", {
        opacity: [0, 1],
        translateY: [54, 0],
        rotateY: stagger([-10, 10]),
        scale: [0.9, 1],
        delay: stagger(140),
        duration: 840,
        ease: "outBack(1.7)",
      }),
      animate(".match-intro-overlay .intro-vs", {
        opacity: [0, 1],
        scale: [0.3, 1.1, 1],
        rotate: [-24, 0],
        duration: 900,
        ease: "outElastic(1, .7)",
      }),
      animate(".match-intro-overlay .intro-avatar", {
        boxShadow: [
          "0 0 0 0 rgba(255,255,255,0)",
          "0 0 0 14px rgba(255,255,255,.06)",
          "0 0 0 8px rgba(255,255,255,.03)",
        ],
        delay: stagger(120),
        duration: 1100,
        ease: "outCubic",
      }),
    ];

    return () => animations.forEach((animation) => animation.revert());
  }, [game.status, showMatchIntro]);

  useEffect(() => {
    if (game.status !== "finished" || !showResultOverlay) return undefined;
    const animations = [
      animate(".result-overlay .result-card", {
        opacity: [0, 1],
        translateY: [42, 0],
        scale: [0.9, 1],
        duration: 720,
        ease: "outBack(1.45)",
      }),
      animate(".result-overlay .result-avatar", {
        scale: [0.75, 1.08, 1],
        rotate: stagger([-8, 8]),
        delay: stagger(120),
        duration: 820,
        ease: "outElastic(1, .75)",
      }),
      animate(".result-overlay .elo-grid div, .result-overlay .result-actions button", {
        opacity: [0, 1],
        translateY: [18, 0],
        delay: stagger(70, { start: 260 }),
        duration: 520,
        ease: "outCubic",
      }),
    ];

    return () => animations.forEach((animation) => animation.revert());
  }, [game.status, showResultOverlay]);

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

  useEffect(() => {
    function onChatMessage(_message: ChatMessage) {
      window.setTimeout(() => {
        chatListRef.current?.scrollTo({ top: chatListRef.current.scrollHeight });
      }, 0);
    }

    socket.on("chat-message", onChatMessage);
    return () => {
      socket.off("chat-message", onChatMessage);
    };
  }, []);

  useEffect(() => {
    chatListRef.current?.scrollTo({ top: chatListRef.current.scrollHeight });
  }, [chatMessages.length]);

  useEffect(() => {
    if (!currentUser || game.status !== "playing") return;

    void updateMatchPresence(roomId, currentUser, true);
    const timer = window.setInterval(() => {
      void updateMatchPresence(roomId, currentUser, true);
    }, 7_000);

    return () => {
      window.clearInterval(timer);
      void updateMatchPresence(roomId, currentUser, false);
    };
  }, [currentUser, game.status, roomId]);

  useEffect(() => {
    if (!currentUser || game.status !== "finished" || game.matchType !== "ranked" || !game.matchId || !game.winner || rankedFinalizeRef.current === game.matchId) return;

    const loser = game.winner === "P1" ? "P2" : "P1";
    const winnerUid = game.players[game.winner].uid;
    const loserUid = game.players[loser].uid;
    if (!winnerUid || !loserUid) return;

    rankedFinalizeRef.current = game.matchId;
    void finalizeRanked(currentUser, game.matchId, winnerUid, loserUid)
      .then((result) => {
        setRankedResult(result);
        return refreshProfile();
      })
      .catch(() => undefined);
  }, [currentUser, game, refreshProfile]);

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
        <section className="match-intro-overlay" onClick={finishMatchIntro}>
          <div className="versus-card">
            <div className={`intro-player intro-you ${myColor}-intro`}>
              <div className={`intro-avatar ${myColor}-avatar`}>
                <img src={profilePictureUrl(game.players[playerId].avatarId)} alt="" />
              </div>
              <span className="intro-label">{t.you}</span>
              <strong>{playerLabel(game, playerId)}</strong>
              <small>{playerSubLabel(game, playerId)} - {matchModeLabel(game.matchType)} - ELO {game.players[playerId].elo}</small>
            </div>
            <div className="intro-vs">VS</div>
            <div className={`intro-player intro-opponent ${opponentColor}-intro`}>
              <div className={`intro-avatar ${opponentColor}-avatar`}>
                <img src={profilePictureUrl(game.players[opponentId].avatarId)} alt="" />
              </div>
              <span className="intro-label">{t.opponent}</span>
              <strong>{playerLabel(game, opponentId)}</strong>
              <small>{playerSubLabel(game, opponentId)} - {matchModeLabel(game.matchType)} - ELO {game.players[opponentId].elo}</small>
            </div>
          </div>
          <p className="intro-skip">{t.tapToSkip}</p>
        </section>
      )}


      {game.status === "finished" && showResultOverlay && (
        <section className={`result-overlay ${didWin ? "win" : "lose"}`}>
          <div className="result-card">
            <div className="result-versus">
              <div className="result-player">
                <span className={`result-avatar ${myColor}`}>
                  <img src={profilePictureUrl(game.players[playerId].avatarId)} alt="" />
                </span>
                <strong>{game.players[playerId].name}</strong>
                <small>{myColor === "blue" ? t.blue : t.red}</small>
              </div>
              <div className="result-title-block">
                <p>{didWin ? t.winTitle : t.loseTitle}</p>
                <h2>{isRankedMatch ? `${didWin ? "+" : ""}${myElo?.delta ?? 0} ELO` : "Unranked"}</h2>
                {!isRankedMatch && <small>No ELO or profile stats changed</small>}
              </div>
              <div className="result-player">
                <span className={`result-avatar ${opponentColor}`}>
                  <img src={profilePictureUrl(game.players[opponentId].avatarId)} alt="" />
                </span>
                <strong>{game.players[opponentId].name}</strong>
                <small>{opponentColor === "blue" ? t.blue : t.red}</small>
              </div>
            </div>

            {isRankedMatch ? (
              <div className="elo-grid">
                <div>
                  <span>{t.you}</span>
                  <strong>{myElo?.before ?? game.players[playerId].elo} -&gt; {myElo?.after ?? game.players[playerId].elo}</strong>
                </div>
                <div>
                  <span>{t.opponent}</span>
                  <strong>{opponentElo?.before ?? game.players[opponentId].elo} -&gt; {opponentElo?.after ?? game.players[opponentId].elo}</strong>
                </div>
              </div>
            ) : (
              <div className="elo-grid unranked-grid">
                <div>
                  <span>Mode</span>
                  <strong>{matchModeLabel(game.matchType)} match</strong>
                </div>
                <div>
                  <span>Result</span>
                  <strong>{didWin ? "Win recorded for this room only" : "No ranked penalty"}</strong>
                </div>
              </div>
            )}

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
      {opponentDisconnected && (
        <section className="disconnect-banner">
          <strong>Enemy left.</strong>
          <span>Reconnecting window: {disconnectSeconds}s</span>
        </section>
      )}

      <section className="play-layout responsive-play-layout">
        <Board
          game={game}
          playerId={playerId}
          draggedWall={draggedWall}
          dragPoint={dragPoint}
          onCellClick={onCellClick}
          onWallClick={onWallClick}
          introStaggerKey={boardIntroStaggerKey}
          onWinAnimationComplete={handleWinAnimationComplete}
        />

        <section className="wall-tray compact-wall-tray mobile-wall-tray" aria-label="Wall tray">
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

        <aside className="side-panel compact-side-panel">
          <section className="wall-tray compact-wall-tray desktop-wall-tray" aria-label="Wall tray">
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

          <section className="players-panel compact-panel">
            {(["P1", "P2"] as PlayerId[]).map((id) => {
              const player = game.players[id];
              return (
                <div key={id} className={`player-line ${id === playerId ? "you" : ""}`}>
                  <span className={`mini-avatar ${player.profileColor || player.color}`}>
                    <img src={profilePictureUrl(player.avatarId)} alt="" />
                  </span>
                  <div>
                    <strong>{playerLabel(game, id)}</strong>
                    <small>{playerSubLabel(game, id)} - {colorName(player.color)} - {formatClock(playerClockMs(id))}</small>
                  </div>
                </div>
              );
            })}
          </section>

          <section className="clock-panel compact-panel">
            <div>
              <span>Turn</span>
              <strong>{formatClock(turnClockMs)}</strong>
            </div>
            <div>
              <span>You</span>
              <strong>{formatClock(playerClockMs(playerId))}</strong>
            </div>
            <div>
              <span>Enemy</span>
              <strong>{formatClock(playerClockMs(opponentId))}</strong>
            </div>
          </section>

          <section className={`turn-card ${isMyTurn ? "my-turn-card" : "enemy-turn-card"}`}>
            <p className="turn-label">{game.status === "finished" ? t.gameFinished : isMyTurn ? t.yourTurn : t.opponentTurn}</p>
            <div className="turn-row">
              <span className={`mini-avatar ${currentPlayer.color}`}>
                <img src={profilePictureUrl(currentPlayer.avatarId)} alt="" />
              </span>
              <div>
                <strong>{playerLabel(game, game.currentTurn)}</strong>
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
              <strong>{chatMessages.length}</strong>
            </div>
            <div className="chat-list" ref={chatListRef}>
              {chatMessages.length === 0 ? (
                <p className="empty-panel-text">{t.chatComingSoon}</p>
              ) : (
                chatMessages.map((message) => (
                  <div key={message.id} className={`chat-message ${message.playerId === playerId ? "mine" : "theirs"}`}>
                    <span>{message.playerId === playerId ? "You" : message.senderName}</span>
                    <p>{message.text}</p>
                  </div>
                ))
              )}
            </div>
            <form className="chat-form" onSubmit={sendChatMessage}>
              <input
                value={chatText}
                onChange={(event) => setChatText(event.target.value)}
                maxLength={180}
                placeholder="Message"
                disabled={game.status === "finished"}
              />
              <button type="submit" disabled={!chatText.trim() || game.status === "finished"}>Send</button>
            </form>
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
