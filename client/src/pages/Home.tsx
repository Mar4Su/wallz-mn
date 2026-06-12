import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, PointerEvent as ReactPointerEvent } from "react";
import * as THREE from "three";
import { animate, stagger } from "animejs";
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

type PlayMode = "ranked" | "casual" | "computer" | "friend";
type SearchMode = "ranked" | "casual" | null;
const AI_DIFFICULTIES: Array<{ id: AiDifficulty; label: string; description: string }> = [
  { id: "easy", label: "Easy", description: "Learns the board, rare walls" },
  { id: "normal", label: "Normal", description: "Moves cleanly and blocks sometimes" },
  { id: "hard", label: "Hard", description: "Aggressive wall pressure" },
  { id: "pro", label: "Pro", description: "Maximum path control" },
];

function HomeBackground3D() {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const mountElement = mount;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x05070c, 0.042);
    const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 120);
    camera.position.set(7.5, 8, 11);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mountElement.appendChild(renderer.domElement);

    const board = new THREE.Group();
    board.rotation.x = -0.08;
    scene.add(board);

    const tileMaterial = new THREE.MeshStandardMaterial({ color: 0x151f2b, roughness: 0.52, metalness: 0.18 });
    const cyanTileMaterial = new THREE.MeshStandardMaterial({ color: 0x164b4c, emissive: 0x0a3435, roughness: 0.42, metalness: 0.2 });
    const redTileMaterial = new THREE.MeshStandardMaterial({ color: 0x4d1d2a, emissive: 0x2b0b13, roughness: 0.42, metalness: 0.2 });
    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xffcf65, emissive: 0x553300, roughness: 0.34, metalness: 0.18 });
    const blueMaterial = new THREE.MeshStandardMaterial({ color: 0x5efff2, emissive: 0x0a5954, roughness: 0.28, metalness: 0.12 });
    const redMaterial = new THREE.MeshStandardMaterial({ color: 0xff6684, emissive: 0x5b0a1a, roughness: 0.28, metalness: 0.12 });
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x6affef, transparent: true, opacity: 0.18 });
    const particleMaterial = new THREE.PointsMaterial({ color: 0x8ffef6, size: 0.035, transparent: true, opacity: 0.62, depthWrite: false });

    const tileGeometry = new THREE.BoxGeometry(0.72, 0.08, 0.72);
    const wallGeometry = new THREE.BoxGeometry(1.56, 0.18, 0.16);
    const pawnGeometry = new THREE.SphereGeometry(0.24, 32, 16);
    const tiles: THREE.Mesh[] = [];
    const walls: THREE.Mesh[] = [];

    for (let row = 0; row < 9; row += 1) {
      for (let col = 0; col < 9; col += 1) {
        const material = row === 0 ? redTileMaterial : row === 8 ? cyanTileMaterial : tileMaterial;
        const tile = new THREE.Mesh(tileGeometry, material);
        tile.position.set((col - 4) * 0.86, Math.sin((row + col) * 0.8) * 0.018, (row - 4) * 0.86);
        board.add(tile);
        tiles.push(tile);
      }
    }

    [
      [-2.5, 0.18, -1.22, 0],
      [-0.88, 0.18, 0.47, Math.PI / 2],
      [1.22, 0.18, 1.36, 0],
      [2.58, 0.18, -0.58, Math.PI / 2],
      [0.1, 0.18, -2.18, 0],
      [-2.15, 0.18, 2.55, Math.PI / 2],
    ].forEach(([x, y, z, rotation]) => {
      const wall = new THREE.Mesh(wallGeometry, wallMaterial);
      wall.position.set(x, y, z);
      wall.rotation.y = rotation;
      board.add(wall);
      walls.push(wall);
    });

    const bluePawn = new THREE.Mesh(pawnGeometry, blueMaterial);
    bluePawn.position.set(-3.42, 0.36, 3.42);
    board.add(bluePawn);

    const redPawn = new THREE.Mesh(pawnGeometry, redMaterial);
    redPawn.position.set(3.42, 0.36, -3.42);
    board.add(redPawn);

    const gridLines = new THREE.Group();
    for (let i = -4; i <= 4; i += 1) {
      const h = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-4.2, 0.02, i * 0.86), new THREE.Vector3(4.2, 0.02, i * 0.86)]);
      const v = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(i * 0.86, 0.02, -4.2), new THREE.Vector3(i * 0.86, 0.02, 4.2)]);
      gridLines.add(new THREE.Line(h, lineMaterial), new THREE.Line(v, lineMaterial));
    }
    board.add(gridLines);

    const particlePositions = new Float32Array(260 * 3);
    for (let i = 0; i < 260; i += 1) {
      particlePositions[i * 3] = (Math.random() - 0.5) * 18;
      particlePositions[i * 3 + 1] = Math.random() * 5.5 + 0.4;
      particlePositions[i * 3 + 2] = (Math.random() - 0.5) * 14;
    }
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particles);

    scene.add(new THREE.HemisphereLight(0xb9fff9, 0x090b10, 2.5));
    const keyLight = new THREE.DirectionalLight(0xfff1bc, 2.35);
    keyLight.position.set(5, 8, 5);
    scene.add(keyLight);
    const cyanLight = new THREE.PointLight(0x35e8d6, 18, 18);
    cyanLight.position.set(-4.5, 2.3, 4.2);
    scene.add(cyanLight);
    const redLight = new THREE.PointLight(0xff5d7a, 12, 16);
    redLight.position.set(4.2, 2.3, -3.8);
    scene.add(redLight);

    const pointer = { x: 0, y: 0 };
    function handlePointerMove(event: PointerEvent) {
      pointer.x = (event.clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
      pointer.y = (event.clientY / Math.max(1, window.innerHeight) - 0.5) * 2;
    }
    window.addEventListener("pointermove", handlePointerMove, { passive: true });

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
      board.rotation.y = -0.68 + Math.sin(frame) * 0.045 + pointer.x * 0.1;
      board.rotation.x = -0.2 + Math.sin(frame * 0.8) * 0.018 - pointer.y * 0.035;
      board.position.x = pointer.x * 0.26;
      board.position.y = -0.2 + pointer.y * -0.08;
      particles.rotation.y += 0.0009;
      bluePawn.position.y = 0.38 + Math.sin(frame * 2.2) * 0.05;
      redPawn.position.y = 0.38 + Math.cos(frame * 2.1) * 0.05;
      walls.forEach((wall, index) => {
        wall.position.y = 0.18 + Math.sin(frame * 1.2 + index) * 0.018;
      });
      tiles.forEach((tile, index) => {
        tile.position.y += Math.sin(frame * 1.7 + index * 0.13) * 0.00045;
      });
      renderer.render(scene, camera);
      animationId = window.requestAnimationFrame(animate);
    }

    resize();
    animate();
    const observer = new ResizeObserver(resize);
    observer.observe(mountElement);

    return () => {
      observer.disconnect();
      window.removeEventListener("pointermove", handlePointerMove);
      window.cancelAnimationFrame(animationId);
      renderer.dispose();
      tileGeometry.dispose();
      wallGeometry.dispose();
      pawnGeometry.dispose();
      particleGeometry.dispose();
      tileMaterial.dispose();
      cyanTileMaterial.dispose();
      redTileMaterial.dispose();
      wallMaterial.dispose();
      blueMaterial.dispose();
      redMaterial.dispose();
      lineMaterial.dispose();
      particleMaterial.dispose();
      mountElement.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div className="home-background-3d" aria-hidden="true">
      <div ref={mountRef} className="home-arena-canvas" />
    </div>
  );
}

function XahaWordmark() {
  return (
    <svg className="xaha-wordmark" viewBox="0 0 386 112" role="img" aria-label="XAHA">
      <title>XAHA</title>
      <g className="xaha-wordmark-lines" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path className="xaha-line" pathLength="1" d="M18 20L82 92" />
        <path className="xaha-line" pathLength="1" d="M82 20L18 92" />
        <path className="xaha-line" pathLength="1" d="M112 92L148 20L184 92" />
        <path className="xaha-line" pathLength="1" d="M126 66H170" />
        <path className="xaha-line" pathLength="1" d="M216 20V92" />
        <path className="xaha-line" pathLength="1" d="M286 20V92" />
        <path className="xaha-line" pathLength="1" d="M216 56H286" />
        <path className="xaha-line" pathLength="1" d="M316 92L342 20" />
        <path className="xaha-line" pathLength="1" d="M342 20L368 92" />
        <path className="xaha-line" pathLength="1" d="M326 66H358" />
      </g>
    </svg>
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
  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--mx", `${event.clientX - rect.left}px`);
    event.currentTarget.style.setProperty("--my", `${event.clientY - rect.top}px`);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    animate(event.currentTarget, {
      scale: [1, 0.965, 1],
      duration: 420,
      ease: "outElastic(1, .65)",
    });
  }

  return (
    <button
      className={`play-mode-card ${variant === "primary" ? "primary-mode" : ""}`}
      onClick={onClick}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
    >
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
  const [currentRank, setCurrentRank] = useState<LeaderboardPlayer | null>(null);
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

  async function refreshLeaderboard() {
    setLeaderboardError(null);
    setLeaderboardLoading(true);

    try {
      const result = await getLeaderboard(50, currentUser);
      setLeaderboard(result.players);
      setCurrentRank(result.currentPlayer);
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

  useEffect(() => {
    void refreshLeaderboard();
  }, [currentUser?.uid]);

  useEffect(() => {
    const animations = [
      animate(".home-v2 .xaha-wordmark", {
        opacity: [0, 1],
        translateY: [22, 0],
        scale: [0.96, 1],
        duration: 900,
        ease: "outCubic",
      }),
      animate(".home-v2 .play-mode-card", {
        opacity: [0, 1],
        translateY: [34, 0],
        rotateX: [18, 0],
        delay: stagger(95),
        duration: 820,
        ease: "outBack(1.6)",
      }),
      animate(".home-v2 .profile-card-v2, .home-v2 .side-leaderboard-card", {
        opacity: [0, 1],
        translateX: [34, 0],
        delay: stagger(120),
        duration: 760,
        ease: "outCubic",
      }),
    ];

    return () => animations.forEach((animation) => animation.revert());
  }, []);

  return (
    <main className="home home-v2">
      <HomeBackground3D />
      <section className="home-shell">
        <section className="home-hero-card">
          <div className="home-title-row">
            <div>
              <p className="eyebrow">Live strategy arena</p>
              <h1 className="sr-only">{t.title}</h1>
              <XahaWordmark />
              <p>{t.subtitle}</p>
            </div>
            <div className="season-pill">
              <span>Playing now</span>
              <strong>{playingCount}</strong>
            </div>
          </div>

          <div className="play-grid">
            <PlayModeCard label="Play" subtitle="Ranked match - login required" meta="ELO" variant="primary" onClick={openRanked} />
            <PlayModeCard label="Casual" subtitle="Unranked - no login needed" meta="Fast" onClick={openCasual} />
            <PlayModeCard label="Play Computer" subtitle="Practice against 4 bot levels" meta="AI" onClick={openComputer} />
            <PlayModeCard label="Play a Friend" subtitle="Create or join by room code" meta="Room" onClick={openFriend} />
          </div>

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

          <section className="side-leaderboard-card">
            <div className="side-leaderboard-head">
              <div>
                <span>Leaderboard</span>
                <strong>Top 50</strong>
              </div>
              <button onClick={() => void refreshLeaderboard()} disabled={leaderboardLoading}>Refresh</button>
            </div>

            {currentUser && currentRank && (
              <div className="my-rank-card">
                <span>Your rank</span>
                <strong>#{currentRank.rank}</strong>
                <small>{currentRank.elo} ELO - {currentRank.wins}W / {currentRank.losses}L</small>
              </div>
            )}

            {!currentUser && <p className="leaderboard-empty compact">Login to see your rank placement.</p>}

            <div className="side-leaderboard-list">
              {leaderboardLoading ? (
                <p className="leaderboard-empty compact">Loading leaderboard...</p>
              ) : leaderboardError ? (
                <p className="leaderboard-empty compact">{leaderboardError}</p>
              ) : leaderboard.length === 0 ? (
                <p className="leaderboard-empty compact">No ranked players yet.</p>
              ) : (
                leaderboard.map((player) => (
                  <div key={player.uid} className={`leaderboard-row compact ${player.uid === currentUser?.uid ? "me" : ""}`}>
                    <span className="leaderboard-rank">#{player.rank}</span>
                    <span className={`leaderboard-avatar ${player.profileColor}`}>
                      <img src={profilePictureUrl(player.avatarId)} alt="" />
                    </span>
                    <div>
                      <strong>{player.displayName}</strong>
                      <small>@{player.publicId} - {player.wins}W / {player.losses}L</small>
                    </div>
                    <b>{player.elo}</b>
                  </div>
                ))
              )}
            </div>
          </section>
        </aside>
      </section>

      {(activePanel === "ranked" || activePanel === "casual" || activePanel === "friend" || activePanel === "computer") && (
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

          </div>
        </section>
      )}
    </main>
  );
}
