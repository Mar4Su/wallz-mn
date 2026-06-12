import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import * as THREE from "three";
import { socket } from "../socket";
import { t } from "../i18n";
import { useAuth } from "../auth/AuthContext";
import { canUseRankedMatchmaking } from "../auth/rankedAccess";
import type { ClientPlayerProfile, TimeControlId } from "../../../shared/types";
import { cancelRanked, cancelRankedWithToken, enqueueRanked, getRankedStatus } from "../rankedApi";
import { getLeaderboard } from "../leaderboardApi";
import type { LeaderboardPlayer } from "../leaderboardApi";
import { PROFILE_PICTURE_IDS, profilePictureUrl } from "../profilePictures";
import type { AiDifficulty } from "../../../shared/types";
import { DEFAULT_TIME_CONTROL_ID, TIME_CONTROLS } from "../../../shared/timeControls";

type Props = {
  error: string | null;
};

type PlayMode = "ranked" | "casual" | "computer" | "friend" | "leaderboard";
type SearchMode = "ranked" | "casual" | null;
const AI_DIFFICULTIES: Array<{ id: AiDifficulty; label: string; description: string }> = [
  { id: "easy", label: "Easy", description: "Learns the board, rare walls" },
  { id: "normal", label: "Normal", description: "Moves cleanly and blocks sometimes" },
  { id: "hard", label: "Hard", description: "Aggressive wall pressure" },
  { id: "pro", label: "Pro", description: "Maximum path control" },
];

function HomeArena3D() {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const mountElement = mount;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(4.5, 6, 7.5);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mountElement.appendChild(renderer.domElement);

    const group = new THREE.Group();
    scene.add(group);

    const tileMaterial = new THREE.MeshStandardMaterial({ color: 0x18212d, roughness: 0.56, metalness: 0.12 });
    const goalMaterial = new THREE.MeshStandardMaterial({ color: 0x1faea5, emissive: 0x0b4a47, roughness: 0.48 });
    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xffcc5c, emissive: 0x4a2600, roughness: 0.38 });
    const blueMaterial = new THREE.MeshStandardMaterial({ color: 0x51fff1, emissive: 0x064a47, roughness: 0.34 });
    const redMaterial = new THREE.MeshStandardMaterial({ color: 0xff607d, emissive: 0x4a0714, roughness: 0.34 });

    const tileGeometry = new THREE.BoxGeometry(0.72, 0.12, 0.72);
    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        const tile = new THREE.Mesh(tileGeometry, row === 0 || row === 4 ? goalMaterial : tileMaterial);
        tile.position.set((col - 2) * 0.86, 0, (row - 2) * 0.86);
        group.add(tile);
      }
    }

    const wallGeometry = new THREE.BoxGeometry(1.5, 0.22, 0.18);
    [
      [-0.9, 0.22, -0.45, 0],
      [0.92, 0.22, 0.5, Math.PI / 2],
      [0.1, 0.22, 1.35, 0],
    ].forEach(([x, y, z, rotation]) => {
      const wall = new THREE.Mesh(wallGeometry, wallMaterial);
      wall.position.set(x, y, z);
      wall.rotation.y = rotation;
      group.add(wall);
    });

    const pawnGeometry = new THREE.SphereGeometry(0.24, 32, 16);
    const bluePawn = new THREE.Mesh(pawnGeometry, blueMaterial);
    bluePawn.position.set(-1.72, 0.38, 1.72);
    group.add(bluePawn);

    const redPawn = new THREE.Mesh(pawnGeometry, redMaterial);
    redPawn.position.set(1.72, 0.38, -1.72);
    group.add(redPawn);

    scene.add(new THREE.HemisphereLight(0xb9fff9, 0x10131a, 2.3));
    const keyLight = new THREE.DirectionalLight(0xfff1bc, 2.1);
    keyLight.position.set(4, 7, 5);
    scene.add(keyLight);

    function resize() {
      const rect = mountElement.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    let frame = 0;
    let animationId = 0;
    function animate() {
      frame += 0.01;
      group.rotation.y = -0.62 + Math.sin(frame) * 0.08;
      group.rotation.x = -0.2 + Math.sin(frame * 0.8) * 0.025;
      bluePawn.position.y = 0.38 + Math.sin(frame * 2.2) * 0.05;
      redPawn.position.y = 0.38 + Math.cos(frame * 2.1) * 0.05;
      renderer.render(scene, camera);
      animationId = window.requestAnimationFrame(animate);
    }

    resize();
    animate();
    const observer = new ResizeObserver(resize);
    observer.observe(mountElement);

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(animationId);
      renderer.dispose();
      tileGeometry.dispose();
      wallGeometry.dispose();
      pawnGeometry.dispose();
      mountElement.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div className="home-arena-3d">
      <div ref={mountRef} className="home-arena-canvas" />
    </div>
  );
}

type PlayModeCardProps = {
  label: string;
  subtitle: string;
  meta?: string;
  variant?: "primary";
  onClick: () => void;
};

function PlayModeCard({ label, subtitle, meta, variant, onClick }: PlayModeCardProps) {
  return (
    <button className={`play-mode-card ${variant === "primary" ? "primary-mode" : ""}`} onClick={onClick}>
      {meta && <em>{meta}</em>}
      <span>{label}</span>
      <small>{subtitle}</small>
    </button>
  );
}

export default function Home({ error }: Props) {
  const [roomCode, setRoomCode] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [activePanel, setActivePanel] = useState<PlayMode | "auth" | null>(null);
  const [searchMode, setSearchMode] = useState<SearchMode>(null);
  const [rankedMatchId, setRankedMatchId] = useState<string | null>(null);
  const [searchStartedAt, setSearchStartedAt] = useState<number | null>(null);
  const [rankedElapsed, setRankedElapsed] = useState(0);
  const [modeMessage, setModeMessage] = useState<string | null>(null);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [aiDifficulty, setAiDifficulty] = useState<AiDifficulty>("normal");
  const [playingCount, setPlayingCount] = useState(0);
  const [selectedTimeControl, setSelectedTimeControl] = useState<TimeControlId>(DEFAULT_TIME_CONTROL_ID);
  const [searchTimeControl, setSearchTimeControl] = useState<TimeControlId>(DEFAULT_TIME_CONTROL_ID);
  const [leaderboard, setLeaderboard] = useState<LeaderboardPlayer[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const rankedCancelTokenRef = useRef<string | null>(null);
  const rankedSearchingRef = useRef(false);
  const { currentUser, profile, loading, authReady, configError, signupWithEmail, loginWithEmail, logout, updateAvatarId } = useAuth();
  const rankedEnabled = canUseRankedMatchmaking(currentUser);

  const winRate = useMemo(() => {
    if (!profile) return 0;
    const total = profile.wins + profile.losses;
    return total === 0 ? 0 : Math.round((profile.wins / total) * 100);
  }, [profile]);

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

  function createRoom() {
    socket.emit("create-room", { profile: playerProfilePayload(), timeControlId: selectedTimeControl });
  }

  function joinRoom() {
    if (!roomCode.trim()) return;
    socket.emit("join-room", { roomId: roomCode.trim().toUpperCase(), profile: playerProfilePayload() });
  }

  function openRanked() {
    setSearchMode(null);
    setRankedMatchId(null);
    if (!currentUser) {
      setActivePanel("auth");
      setModeMessage("Login to play ranked and save your stats.");
      return;
    }

    if (!rankedEnabled) {
      setActivePanel("ranked");
      setModeMessage("Please verify your email before playing ranked.");
      return;
    }

    setActivePanel("ranked");
    setModeMessage(null);
  }

  async function startRanked() {
    if (!currentUser || !rankedEnabled) return;
    setActivePanel("ranked");
    setModeMessage("Searching for ranked opponent...");
    setSearchMode("ranked");
    setSearchStartedAt(Date.now());
    setRankedElapsed(0);
    setSearchTimeControl(selectedTimeControl);
    rankedSearchingRef.current = true;

    try {
      rankedCancelTokenRef.current = await currentUser.getIdToken();
      const result = await enqueueRanked(currentUser, selectedTimeControl);
      if (result.status === "matched" && result.matchId) {
        rankedSearchingRef.current = false;
        setRankedMatchId(result.matchId);
        setModeMessage("Ranked match found. Entering game...");
      }
    } catch (err) {
      rankedSearchingRef.current = false;
      rankedCancelTokenRef.current = null;
      setSearchMode(null);
      setModeMessage(err instanceof Error ? err.message : "Could not start ranked search.");
    }
  }

  function openCasual() {
    setRankedMatchId(null);
    setActivePanel("casual");
    setModeMessage(null);
    setSearchMode(null);
  }

  function startCasual() {
    setActivePanel("casual");
    setModeMessage("Searching casual match...");
    setSearchMode("casual");
    setSearchStartedAt(Date.now());
    setSearchTimeControl(selectedTimeControl);
    socket.emit("casual-search", { profile: playerProfilePayload(), timeControlId: selectedTimeControl });
  }

  function openComputer() {
    setSearchMode(null);
    setActivePanel("computer");
    setModeMessage(null);
  }

  function startComputer(difficulty = aiDifficulty) {
    setAiDifficulty(difficulty);
    setSearchMode(null);
    setActivePanel("computer");
    setModeMessage(`Starting ${difficulty} computer match...`);
    socket.emit("create-ai-room", { profile: playerProfilePayload(), difficulty, timeControlId: selectedTimeControl });
  }

  function openFriend() {
    setSearchMode(null);
    setModeMessage(null);
    setActivePanel("friend");
  }

  async function openLeaderboard() {
    setSearchMode(null);
    setModeMessage(null);
    setActivePanel("leaderboard");
    setLeaderboardError(null);
    setLeaderboardLoading(true);

    try {
      setLeaderboard(await getLeaderboard(25));
    } catch (err) {
      setLeaderboardError(err instanceof Error ? err.message : "Could not load leaderboard.");
    } finally {
      setLeaderboardLoading(false);
    }
  }

  async function cancelSearch() {
    if (searchMode === "ranked" && currentUser) {
      await cancelRanked(currentUser).catch(() => undefined);
      rankedCancelTokenRef.current = null;
      rankedSearchingRef.current = false;
    }
    if (searchMode === "casual") {
      socket.emit("casual-cancel");
    }
    setSearchMode(null);
    setRankedMatchId(null);
    setSearchStartedAt(null);
    setModeMessage(null);
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError(null);
    setAuthBusy(true);

    try {
      if (authMode === "register") {
        await signupWithEmail(email, password, displayName);
      } else {
        await loginWithEmail(email, password);
      }
      setPassword("");
      setModeMessage(null);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Could not sign in.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function onAvatarPick(avatarId: string) {
    setProfileMessage(null);
    try {
      await updateAvatarId(avatarId);
    } catch (err) {
      setProfileMessage(err instanceof Error ? err.message : "Could not update profile picture.");
    }
  }

  useEffect(() => {
    if (searchMode !== "ranked" || !searchStartedAt) return;

    const timer = window.setInterval(() => {
      setRankedElapsed(Math.floor((Date.now() - searchStartedAt) / 1000));
    }, 500);

    return () => window.clearInterval(timer);
  }, [searchMode, searchStartedAt]);

  useEffect(() => {
    if (searchMode !== "ranked" || !currentUser || rankedMatchId) return;

    const timer = window.setInterval(() => {
      void getRankedStatus(currentUser)
        .then(async (result) => {
          if (result.status !== "matched" || !result.matchId) {
            result = await enqueueRanked(currentUser, searchTimeControl);
          }

          if (result.status === "matched" && result.matchId) {
            rankedSearchingRef.current = false;
            setRankedMatchId(result.matchId);
            setModeMessage("Ranked match found. Entering game...");
          }
        })
        .catch((err) => {
          setSearchMode(null);
          setModeMessage(err instanceof Error ? err.message : "Ranked search failed.");
        });
    }, 2_500);

    return () => window.clearInterval(timer);
  }, [currentUser, rankedMatchId, searchMode, searchTimeControl]);

  useEffect(() => {
    rankedSearchingRef.current = searchMode === "ranked" && !rankedMatchId;
  }, [rankedMatchId, searchMode]);

  useEffect(() => {
    function cancelOnLeave() {
      if (!rankedSearchingRef.current || !rankedCancelTokenRef.current) return;
      cancelRankedWithToken(rankedCancelTokenRef.current);
      rankedSearchingRef.current = false;
    }

    window.addEventListener("beforeunload", cancelOnLeave);
    window.addEventListener("pagehide", cancelOnLeave);
    return () => {
      window.removeEventListener("beforeunload", cancelOnLeave);
      window.removeEventListener("pagehide", cancelOnLeave);
      cancelOnLeave();
    };
  }, []);

  useEffect(() => {
    function onPresenceCount(payload: { online?: number; playing?: number }) {
      setPlayingCount(Math.max(0, Number(payload.playing ?? 0)));
    }

    socket.on("presence-count", onPresenceCount);
    return () => {
      socket.off("presence-count", onPresenceCount);
    };
  }, []);

  useEffect(() => {
    if (!rankedMatchId || !currentUser) return;

    void currentUser.getIdToken().then((idToken) => {
      socket.emit("join-ranked-match", { matchId: rankedMatchId, idToken });
    });
  }, [currentUser, rankedMatchId]);

  return (
    <main className="home home-v2">
      <section className="home-shell">
        <section className="home-hero-card">
          <div className="home-title-row">
            <div>
              <p className="eyebrow">Live strategy arena</p>
              <h1>{t.title}</h1>
              <p>{t.subtitle}</p>
            </div>
            <div className="season-pill">
              <span>Playing now</span>
              <strong>{playingCount}</strong>
            </div>
          </div>

          <HomeArena3D />

          <div className="play-grid">
            <PlayModeCard label="Play" subtitle="Ranked match - login required" meta="ELO" variant="primary" onClick={openRanked} />
            <PlayModeCard label="Casual" subtitle="Unranked - no login needed" meta="Fast" onClick={openCasual} />
            <PlayModeCard label="Play Computer" subtitle="Practice against 4 bot levels" meta="AI" onClick={openComputer} />
            <PlayModeCard label="Play a Friend" subtitle="Create or join by room code" meta="Room" onClick={openFriend} />
          </div>

          <button className="leaderboard-strip" onClick={() => void openLeaderboard()}>
            <span>Leaderboard</span>
            <strong>Top ranked players</strong>
          </button>

          {(modeMessage || searchMode) && (
            <section className="mode-status-panel">
              <p>{searchMode === "ranked" ? `${modeMessage ?? "Searching for ranked opponent..."} ${rankedElapsed}s` : modeMessage ?? "Searching casual match..."}</p>
              {searchMode && (
                <button className="secondary-button" onClick={cancelSearch}>
                  Cancel
                </button>
              )}
            </section>
          )}

          {error && <p className="error-text">{error}</p>}
        </section>

        <aside className="home-side">
          <section className="profile-card-v2">
            {loading ? (
              <p className="auth-muted">Loading account...</p>
            ) : currentUser && profile ? (
              <div className="profile-summary">
                <div className="profile-head">
                  <span className={`profile-avatar ${profile.profileColor}`}>
                    <img src={profilePictureUrl(profile.avatarId)} alt="" />
                  </span>
                  <div>
                    <span className="profile-label">Profile</span>
                    <strong>{profile.displayName}</strong>
                    <small>@{profile.publicId} - {profile.email}</small>
                  </div>
                </div>

                <div className="profile-stats">
                  <span>ELO {profile.elo}</span>
                  <span>{profile.wins}W / {profile.losses}L</span>
                  <span>{winRate}% win rate</span>
                </div>

                <div className="avatar-picker" aria-label="Profile pictures">
                  {PROFILE_PICTURE_IDS.map((avatarId) => (
                    <button
                      key={avatarId}
                      className={profile.avatarId === avatarId ? "active" : ""}
                      onClick={() => void onAvatarPick(avatarId)}
                      disabled={!currentUser.emailVerified}
                      title={currentUser.emailVerified ? "Use this picture" : "Verify email to change picture"}
                    >
                      <img src={profilePictureUrl(avatarId)} alt="" />
                    </button>
                  ))}
                </div>

                {profileMessage && <p className="verify-warning">{profileMessage}</p>}
                {!currentUser.emailVerified && <p className="verify-warning">Please verify your email before playing ranked.</p>}
                <button className="secondary-button" onClick={() => void logout()}>
                  Logout
                </button>
              </div>
            ) : (
              <section className="auth-panel" aria-label="Account">
                <div className="account-card-heading">
                  <span>Account</span>
                  <strong>{authMode === "register" ? "Create profile" : "Welcome back"}</strong>
                </div>
                <p className="auth-muted">Login to play ranked and save your stats.</p>
                {!authReady ? (
                  <p className="verify-warning">{configError ?? "Firebase Auth is not configured yet."}</p>
                ) : (
                  <form className="auth-form" onSubmit={submitAuth}>
                    <div className="auth-tabs">
                      <button type="button" className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}>
                        Login
                      </button>
                      <button type="button" className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")}>
                        Register
                      </button>
                    </div>

                    {authMode === "register" && (
                      <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Username / public ID" required />
                    )}
                    <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" type="email" required />
                    <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" type="password" minLength={6} required />

                    <button className="secondary-button" type="submit" disabled={authBusy}>
                      {authBusy ? "Please wait..." : authMode === "register" ? "Create account" : "Login"}
                    </button>
                    {authError && <p className="error-text">{authError}</p>}
                  </form>
                )}
              </section>
            )}
          </section>
        </aside>
      </section>

      {(activePanel === "ranked" || activePanel === "casual" || activePanel === "friend" || activePanel === "computer" || activePanel === "leaderboard") && (
        <section className="home-modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !searchMode) setActivePanel(null);
        }}>
          <div className="home-modal" role="dialog" aria-modal="true">
            <button className="modal-close-button" onClick={() => setActivePanel(null)} disabled={!!searchMode}>
              x
            </button>

            {(activePanel === "ranked" || activePanel === "casual") && (
              <>
                <div className="modal-heading">
                  <span>{activePanel === "ranked" ? "Ranked Matchmaking" : "Casual Matchmaking"}</span>
                  <strong>{activePanel === "ranked" ? "Choose your clock" : "Find an unranked game"}</strong>
                </div>

                <div className="time-control-grid">
                  {TIME_CONTROLS.map((control) => (
                    <button
                      key={control.id}
                      className={selectedTimeControl === control.id ? "active" : ""}
                      onClick={() => setSelectedTimeControl(control.id)}
                      disabled={!!searchMode}
                    >
                      <strong>{control.id}</strong>
                      <small>{control.label}</small>
                    </button>
                  ))}
                </div>

                <div className="modal-search-status">
                  <p>
                    {searchMode
                      ? `${modeMessage ?? "Searching..."} ${searchMode === "ranked" ? `${rankedElapsed}s` : ""}`
                      : activePanel === "ranked"
                        ? "Only players with the same clock will be matched."
                        : "Casual pairs only with the same clock mode."}
                  </p>
                </div>

                {searchMode ? (
                  <button className="secondary-button" onClick={cancelSearch}>Cancel search</button>
                ) : (
                  <button className="primary-button" onClick={activePanel === "ranked" ? startRanked : startCasual}>
                    {activePanel === "ranked" ? "Start ranked search" : "Start casual search"}
                  </button>
                )}
              </>
            )}

            {activePanel === "friend" && (
              <>
                <div className="modal-heading">
                  <span>Friend Room</span>
                  <strong>Create or join</strong>
                </div>
                <div className="time-control-grid">
                  {TIME_CONTROLS.map((control) => (
                    <button key={control.id} className={selectedTimeControl === control.id ? "active" : ""} onClick={() => setSelectedTimeControl(control.id)}>
                      <strong>{control.id}</strong>
                      <small>{control.label}</small>
                    </button>
                  ))}
                </div>
                <button className="primary-button" onClick={createRoom}>Create room</button>
                <div className="join-box modal-join-box">
                  <input value={roomCode} onChange={(event) => setRoomCode(event.target.value)} placeholder={t.roomCode} maxLength={5} />
                  <button onClick={joinRoom}>{t.joinRoom}</button>
                </div>
              </>
            )}

            {activePanel === "computer" && (
              <>
                <div className="modal-heading">
                  <span>Computer</span>
                  <strong>Pick difficulty</strong>
                </div>
                <div className="difficulty-grid">
                  {AI_DIFFICULTIES.map((difficulty) => (
                    <button
                      key={difficulty.id}
                      className={aiDifficulty === difficulty.id ? "active" : ""}
                      onClick={() => setAiDifficulty(difficulty.id)}
                    >
                      <strong>{difficulty.label}</strong>
                      <small>{difficulty.description}</small>
                    </button>
                  ))}
                </div>
                <div className="time-control-grid">
                  {TIME_CONTROLS.map((control) => (
                    <button key={control.id} className={selectedTimeControl === control.id ? "active" : ""} onClick={() => setSelectedTimeControl(control.id)}>
                      <strong>{control.id}</strong>
                      <small>{control.label}</small>
                    </button>
                  ))}
                </div>
                <button className="primary-button" onClick={() => startComputer()}>
                  Start {AI_DIFFICULTIES.find((difficulty) => difficulty.id === aiDifficulty)?.label ?? "Normal"}
                </button>
              </>
            )}

            {activePanel === "leaderboard" && (
              <>
                <div className="modal-heading">
                  <span>Leaderboard</span>
                  <strong>Top ranked players</strong>
                </div>

                <div className="leaderboard-list">
                  {leaderboardLoading ? (
                    <p className="leaderboard-empty">Loading leaderboard...</p>
                  ) : leaderboardError ? (
                    <p className="leaderboard-empty">{leaderboardError}</p>
                  ) : leaderboard.length === 0 ? (
                    <p className="leaderboard-empty">No ranked players yet.</p>
                  ) : (
                    leaderboard.map((player) => (
                      <div key={player.uid} className="leaderboard-row">
                        <span className="leaderboard-rank">#{player.rank}</span>
                        <span className={`leaderboard-avatar ${player.profileColor}`}>
                          <img src={profilePictureUrl(player.avatarId)} alt="" />
                        </span>
                        <div>
                          <strong>{player.displayName}</strong>
                          <small>@{player.publicId} · {player.wins}W / {player.losses}L · {player.winRate}%</small>
                        </div>
                        <b>{player.elo}</b>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
