import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ClientPlayerProfile, GameState, PlayerId } from "../../shared/types";
import { socket } from "./socket";
import Home from "./pages/Home";
import Game from "./pages/Game";
import ProfilePage from "./pages/ProfilePage";
import { useAuth } from "./auth/AuthContext";

type SavedRoomSeat = {
  roomId: string;
  playerId: PlayerId;
};

type GlobalRematchRequest = {
  roomId: string;
  playerId: PlayerId;
  fromPlayerId: PlayerId;
  fromName: string;
  expiresAt: number;
};

const ACTIVE_ROOM_KEY = "wallz.activeRoom";

function roomIdFromPath(): string | null {
  const match = window.location.pathname.match(/^\/rooms\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function userIdFromPath(): string | null {
  const match = window.location.pathname.match(/^\/user\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function saveRoomSeat(roomId: string, playerId: PlayerId): void {
  localStorage.setItem(ACTIVE_ROOM_KEY, JSON.stringify({ roomId, playerId }));
}

function readRoomSeat(roomId: string): SavedRoomSeat | null {
  try {
    const saved = JSON.parse(localStorage.getItem(ACTIVE_ROOM_KEY) ?? "null") as SavedRoomSeat | null;
    return saved?.roomId === roomId ? saved : null;
  } catch {
    return null;
  }
}

function setRoomPath(roomId: string): void {
  const nextPath = `/rooms/${encodeURIComponent(roomId)}`;
  if (window.location.pathname !== nextPath) window.history.pushState(null, "", nextPath);
}

export default function App() {
  const { currentUser, profile, authReady } = useAuth();
  const [roomId, setRoomId] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<PlayerId | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState(window.location.pathname);
  const [globalRematch, setGlobalRematch] = useState<GlobalRematchRequest | null>(null);
  const [globalRematchNow, setGlobalRematchNow] = useState(Date.now());
  const attemptedRoomRef = useRef<string | null>(null);
  const activeRoomRef = useRef<string | null>(null);

  function playerProfilePayload(): ClientPlayerProfile | undefined {
    if (!currentUser || !profile) return undefined;
    return {
      uid: currentUser.uid,
      displayName: profile.displayName,
      publicId: profile.publicId,
      avatarId: profile.avatarId,
      profileColor: profile.profileColor,
      elo: profile.elo,
      wins: profile.wins,
      losses: profile.losses,
    };
  }

  function goHome() {
    localStorage.removeItem(ACTIVE_ROOM_KEY);
    if (window.location.pathname.startsWith("/rooms/")) window.history.pushState(null, "", "/");
    setRoomId(null);
    setPlayerId(null);
    setGame(null);
    setError(null);
    setPath("/");
  }

  function goProfile() {
    window.history.pushState(null, "", "/profile");
    setPath("/profile");
  }

  function acceptGlobalRematch() {
    if (!globalRematch) return;
    socket.emit("accept-rematch", { roomId: globalRematch.roomId, playerId: globalRematch.playerId });
    setGlobalRematch(null);
  }

  function declineGlobalRematch() {
    if (!globalRematch) return;
    socket.emit("decline-rematch", { roomId: globalRematch.roomId, playerId: globalRematch.playerId });
    setGlobalRematch(null);
  }

  useEffect(() => {
    function onPopState() {
      setPath(window.location.pathname);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    activeRoomRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    socket.on("room-created", ({ roomId, playerId, game }) => {
      saveRoomSeat(roomId, playerId);
      setRoomPath(roomId);
      setRoomId(roomId);
      setPlayerId(playerId);
      setGame(game);
      setError(null);
    });

    socket.on("game-started", ({ roomId, playerId, game }) => {
      saveRoomSeat(roomId, playerId);
      setRoomPath(roomId);
      setRoomId(roomId);
      setPlayerId(playerId);
      setGame(game);
      setError(null);
    });

    socket.on("rematch-started", ({ roomId, playerId, game }) => {
      setGlobalRematch(null);
      saveRoomSeat(roomId, playerId);
      setRoomPath(roomId);
      setRoomId(roomId);
      setPlayerId(playerId);
      setGame(game);
      setError(null);
    });

    socket.on("rematch-requested", (payload: GlobalRematchRequest) => {
      if (activeRoomRef.current) return;
      setGlobalRematch(payload);
      setGlobalRematchNow(Date.now());
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

    socket.on("opponent-disconnected", ({ message }) => {
      setError(message ?? "Opponent disconnected. Ending match...");
    });

    socket.on("match-abandoned", ({ message }) => {
      setError(message ?? "Opponent disconnected. Match ended.");
    });

    return () => {
      socket.off("room-created");
      socket.off("game-started");
      socket.off("rematch-started");
      socket.off("rematch-requested");
      socket.off("game-updated");
      socket.off("invalid-move");
      socket.off("game-over");
      socket.off("opponent-disconnected");
      socket.off("match-abandoned");
    };
  }, []);

  useEffect(() => {
    if (!globalRematch) return;
    const timer = window.setInterval(() => setGlobalRematchNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [globalRematch]);

  useEffect(() => {
    if (!globalRematch) return;
    if (globalRematch.expiresAt <= globalRematchNow) setGlobalRematch(null);
  }, [globalRematch, globalRematchNow]);

  useEffect(() => {
    if (!authReady) return;
    const pathRoomId = roomIdFromPath();
    if (!pathRoomId || roomId || attemptedRoomRef.current === pathRoomId) return;
    attemptedRoomRef.current = pathRoomId;

    const savedSeat = readRoomSeat(pathRoomId);
    if (savedSeat) {
      void currentUser?.getIdToken().then((idToken) => {
        socket.emit("rejoin-room", {
          roomId: pathRoomId,
          playerId: savedSeat.playerId,
          profile: playerProfilePayload(),
          idToken,
        });
      });
      if (!currentUser) {
        socket.emit("rejoin-room", {
          roomId: pathRoomId,
          playerId: savedSeat.playerId,
          profile: playerProfilePayload(),
        });
      }
      return;
    }

    socket.emit("join-room", { roomId: pathRoomId, profile: playerProfilePayload() });
  }, [authReady, currentUser, profile, roomId]);

  const rematchSecondsLeft = globalRematch
    ? Math.max(0, Math.ceil((globalRematch.expiresAt - globalRematchNow) / 1000))
    : 0;

  let page: ReactNode;
  if (!roomId || !playerId || !game) {
    if (path === "/profile") {
      page = <ProfilePage mode="own" onGoHome={goHome} />;
    } else {
      const publicUserId = userIdFromPath();
      if (publicUserId) {
        page = <ProfilePage mode="public" identifier={publicUserId} onGoHome={goHome} />;
      } else {
        page = <Home error={error} onGoProfile={goProfile} />;
      }
    }
  } else {
    page = <Game roomId={roomId} playerId={playerId} game={game} error={error} onGoHome={goHome} />;
  }

  return (
    <>
      {page}
      {globalRematch ? (
        <div className="global-rematch-backdrop" role="presentation">
          <section className="global-rematch-card" role="dialog" aria-modal="true" aria-label="Rematch request">
            <span>Rematch request</span>
            <h2>{globalRematch.fromName} wants another game</h2>
            <p>Accept within {rematchSecondsLeft}s or the request expires.</p>
            <div className="global-rematch-actions">
              <button type="button" onClick={acceptGlobalRematch}>Accept</button>
              <button type="button" onClick={declineGlobalRematch}>Cancel</button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
