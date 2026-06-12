import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent, PointerEvent as ReactPointerEvent } from "react";
import * as THREE from "three";
import { animate, stagger } from "animejs";
import { socket } from "../socket";
import { t } from "../i18n";
import { useAuth } from "../auth/AuthContext";
import { canUseRankedMatchmaking } from "../auth/rankedAccess";
import type { ClientPlayerProfile, MoveRecord, PlayerId, Position, TimeControlId, Wall } from "../../../shared/types";
import { cancelRanked, cancelRankedWithToken, enqueueRanked, getRankedStatus } from "../rankedApi";
import { getLeaderboard } from "../leaderboardApi";
import type { LeaderboardPlayer } from "../leaderboardApi";
import { getMyMatchHistory } from "../matchHistoryApi";
import type { MatchHistoryPlayer, MatchHistoryRecord } from "../matchHistoryApi";
import { PROFILE_PICTURE_IDS, profilePictureUrl } from "../profilePictures";
import type { AiDifficulty } from "../../../shared/types";
import { DEFAULT_TIME_CONTROL_ID, TIME_CONTROLS } from "../../../shared/timeControls";

type Props = {
  error: string | null;
};

type PlayMode = "ranked" | "casual" | "computer" | "friend";
type SearchMode = "ranked" | "casual" | null;
type Language = "mn" | "en";

const HOME_TEXT = {
  mn: {
    arena: "Амьд стратегийн талбар",
    subtitle: "9x9 талбар дээрх хурдан стратеги тоглоом",
    playingNow: "Тоглож байна",
    play: "Тоглох",
    ranked: "Ranked тоглолт - нэвтрэх шаардлагатай",
    casual: "Энгийн",
    casualSub: "Оноо тооцохгүй - нэвтрэх шаардлагагүй",
    computer: "Компьютертэй тоглох",
    computerSub: "4 түвшний bot эсрэг дасгал",
    friend: "Найзтай тоглох",
    friendSub: "Өрөө үүсгэх эсвэл кодоор орох",
    loginSave: "Ranked тоглож, статистикаа хадгалахын тулд нэвтэрнэ үү.",
    account: "Бүртгэл",
    profile: "Профайл",
    logout: "Гарах",
    login: "Нэвтрэх",
    register: "Бүртгүүлэх",
    createAccount: "Бүртгэл үүсгэх",
    rankOutOf: "нийт тоглогчоос",
    recentForm: "Сүүлийн 5",
    history: "Тоглолтын түүх",
    noHistory: "Ranked тоглолт дууссаны дараа түүх энд гарна.",
    replay: "Replay",
    viewProfile: "Профайл харах",
    leaderboard: "Чансаа",
    top50: "Top 50",
    refresh: "Шинэчлэх",
  },
  en: {
    arena: "Live strategy arena",
    subtitle: "Fast strategy on a 9x9 board",
    playingNow: "Playing now",
    play: "Play",
    ranked: "Ranked match - login required",
    casual: "Casual",
    casualSub: "Unranked - no login needed",
    computer: "Play Computer",
    computerSub: "Practice against 4 bot levels",
    friend: "Play a Friend",
    friendSub: "Create or join by room code",
    loginSave: "Login to play ranked and save your stats.",
    account: "Account",
    profile: "Profile",
    logout: "Logout",
    login: "Login",
    register: "Register",
    createAccount: "Create account",
    rankOutOf: "out of",
    recentForm: "Recent 5",
    history: "Match history",
    noHistory: "Finished ranked matches will appear here.",
    replay: "Replay",
    viewProfile: "View profile",
    leaderboard: "Leaderboard",
    top50: "Top 50",
    refresh: "Refresh",
  },
} satisfies Record<Language, Record<string, string>>;

const AI_DIFFICULTIES: Array<{ id: AiDifficulty; label: string; description: string }> = [
  { id: "easy", label: "Easy", description: "Learns the board, rare walls" },
  { id: "normal", label: "Normal", description: "Moves cleanly and blocks sometimes" },
  { id: "hard", label: "Hard", description: "Aggressive wall pressure" },
  { id: "pro", label: "Pro", description: "Maximum path control" },
];

function ordinal(rank: number): string {
  const mod100 = rank % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rank}th`;
  const mod10 = rank % 10;
  if (mod10 === 1) return `${rank}st`;
  if (mod10 === 2) return `${rank}nd`;
  if (mod10 === 3) return `${rank}rd`;
  return `${rank}th`;
}

function ReplayPreview({ match, onClose }: { match: MatchHistoryRecord; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const moves = match.moves ?? [];
  const boardSize = 9;

  useEffect(() => {
    if (!playing || step >= moves.length) return undefined;
    const timer = window.setTimeout(() => setStep((value) => Math.min(moves.length, value + 1)), 720);
    return () => window.clearTimeout(timer);
  }, [moves.length, playing, step]);

  const replayState = useMemo(() => {
    const positions: Record<PlayerId, Position> = {
      P1: { row: 8, col: 4 },
      P2: { row: 0, col: 4 },
    };
    const walls: Wall[] = [];
    moves.slice(0, step).forEach((move: MoveRecord) => {
      if (move.kind === "pawn" && move.to) positions[move.playerId] = { ...move.to };
      if (move.kind === "wall" && move.wall) walls.push({ ...move.wall });
    });
    return { positions, walls };
  }, [moves, step]);

  return (
    <section className="home-modal-backdrop replay-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="home-modal replay-modal" role="dialog" aria-modal="true">
        <button className="modal-close-button" onClick={onClose}>x</button>
        <div className="modal-heading">
          <span>{match.result === "win" ? "Win replay" : "Loss replay"}</span>
          <strong>vs {match.opponentName}</strong>
        </div>
        <div className="replay-board">
          {Array.from({ length: boardSize * boardSize }, (_, index) => {
            const row = Math.floor(index / boardSize);
            const col = index % boardSize;
            const pawn = replayState.positions.P1.row === row && replayState.positions.P1.col === col ? "P1" : replayState.positions.P2.row === row && replayState.positions.P2.col === col ? "P2" : null;
            return (
              <div key={`${row}-${col}`} className="replay-cell">
                {pawn && <span className={`replay-pawn ${pawn === "P1" ? "blue" : "red"}`} />}
              </div>
            );
          })}
          {replayState.walls.map((wall, index) => (
            <span
              key={`${wall.row}-${wall.col}-${wall.orientation}-${index}`}
              className={`replay-wall ${wall.orientation === "H" ? "horizontal" : "vertical"}`}
              style={{
                "--wall-row": wall.row,
                "--wall-col": wall.col,
              } as CSSProperties}
            />
          ))}
        </div>
        <div className="replay-controls">
          <button onClick={() => setStep((value) => Math.max(0, value - 1))}>Prev</button>
          <button onClick={() => setPlaying((value) => !value)}>{playing ? "Pause" : "Play"}</button>
          <button onClick={() => setStep((value) => Math.min(moves.length, value + 1))}>Next</button>
        </div>
        <p className="replay-step">Move {step} / {moves.length}</p>
      </div>
    </section>
  );
}

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
  const [accountOpen, setAccountOpen] = useState(false);
  const [language, setLanguage] = useState<Language>("mn");
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
  const [matchHistory, setMatchHistory] = useState<MatchHistoryRecord[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selectedReplay, setSelectedReplay] = useState<MatchHistoryRecord | null>(null);
  const [selectedOpponent, setSelectedOpponent] = useState<MatchHistoryPlayer | null>(null);
  const rankedCancelTokenRef = useRef<string | null>(null);
  const rankedSearchingRef = useRef(false);
  const { currentUser, profile, loading, authReady, configError, signupWithEmail, loginWithEmail, logout, updateAvatarId } = useAuth();
  const rankedEnabled = canUseRankedMatchmaking(currentUser);
  const homeText = HOME_TEXT[language];

  const winRate = useMemo(() => {
    if (!profile) return 0;
    const total = profile.wins + profile.losses;
    return total === 0 ? 0 : Math.round((profile.wins / total) * 100);
  }, [profile]);
  const totalRankedPlayers = leaderboard.length;
  const rankPlacement = currentRank?.rank ? `${ordinal(currentRank.rank)} ${homeText.rankOutOf} ${Math.max(totalRankedPlayers, currentRank.rank)} players` : "Unranked";
  const recentResults = matchHistory.slice(0, 5);

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
      setAccountOpen(true);
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
      setAccountOpen(false);
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

  async function refreshMatchHistory() {
    if (!currentUser) {
      setMatchHistory([]);
      return;
    }

    setHistoryError(null);
    try {
      setMatchHistory(await getMyMatchHistory(currentUser, 8));
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "Could not load match history.");
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
    void refreshMatchHistory();
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
      <header className="home-topbar">
        <button className="language-toggle" onClick={() => setLanguage((value) => value === "mn" ? "en" : "mn")}>
          {language === "mn" ? "MN" : "EN"}
        </button>
        <div className="account-menu">
          <button className="account-trigger" onClick={() => setAccountOpen((value) => !value)}>
            {currentUser && profile ? (
              <>
                <span className={`mini-avatar ${profile.profileColor}`}>
                  <img src={profilePictureUrl(profile.avatarId)} alt="" />
                </span>
                <strong>{profile.displayName}</strong>
              </>
            ) : (
              <strong>{homeText.login}</strong>
            )}
          </button>

          {accountOpen && (
            <section className="account-dropdown">
              {currentUser && profile ? (
                <>
                  <button onClick={() => {
                    setAccountOpen(false);
                    document.querySelector(".profile-card-v2")?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}>{homeText.profile}</button>
                  <button onClick={() => void logout()}>{homeText.logout}</button>
                </>
              ) : !authReady ? (
                <p className="verify-warning">{configError ?? "Firebase Auth is not configured yet."}</p>
              ) : (
                <form className="auth-form" onSubmit={submitAuth}>
                  <div className="auth-tabs">
                    <button type="button" className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}>
                      {homeText.login}
                    </button>
                    <button type="button" className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")}>
                      {homeText.register}
                    </button>
                  </div>
                  {authMode === "register" && (
                    <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Username / public ID" required />
                  )}
                  <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" type="email" required />
                  <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" type="password" minLength={6} required />
                  <button className="secondary-button" type="submit" disabled={authBusy}>
                    {authBusy ? "Please wait..." : authMode === "register" ? homeText.createAccount : homeText.login}
                  </button>
                  {authError && <p className="error-text">{authError}</p>}
                </form>
              )}
            </section>
          )}
        </div>
      </header>
      <section className="home-shell">
        <section className="home-hero-card">
          <div className="home-title-row">
            <div>
              <p className="eyebrow">{homeText.arena}</p>
              <h1 className="sr-only">{t.title}</h1>
              <XahaWordmark />
              <p>{homeText.subtitle}</p>
            </div>
            <div className="season-pill">
              <span>{homeText.playingNow}</span>
              <strong>{playingCount}</strong>
            </div>
          </div>

          <div className="play-grid">
            <PlayModeCard label={homeText.play} subtitle={homeText.ranked} meta="ELO" variant="primary" onClick={openRanked} />
            <PlayModeCard label={homeText.casual} subtitle={homeText.casualSub} meta="Fast" onClick={openCasual} />
            <PlayModeCard label={homeText.computer} subtitle={homeText.computerSub} meta="AI" onClick={openComputer} />
            <PlayModeCard label={homeText.friend} subtitle={homeText.friendSub} meta="Room" onClick={openFriend} />
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
                    <span className="profile-label">{homeText.profile}</span>
                    <strong>{profile.displayName}</strong>
                    <small>@{profile.publicId} - {profile.email}</small>
                  </div>
                </div>

                <div className="profile-stats">
                  <span>ELO {profile.elo}</span>
                  <span>{rankPlacement}</span>
                  <span>{winRate}% win rate</span>
                </div>

                <div className="recent-form">
                  <span>{homeText.recentForm}</span>
                  <div>
                    {recentResults.length > 0 ? recentResults.map((match) => (
                      <b key={match.matchId} className={match.result}>{match.result === "win" ? "W" : "L"}</b>
                    )) : <small>No ranked games yet</small>}
                  </div>
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

                <section className="match-history-card">
                  <div className="match-history-head">
                    <span>{homeText.history}</span>
                    <button onClick={() => void refreshMatchHistory()}>Refresh</button>
                  </div>
                  {historyError ? (
                    <p className="leaderboard-empty compact">{historyError}</p>
                  ) : matchHistory.length === 0 ? (
                    <p className="leaderboard-empty compact">{homeText.noHistory}</p>
                  ) : (
                    <div className="match-history-list">
                      {matchHistory.slice(0, 5).map((match) => (
                        <article key={match.matchId} className={`match-history-row ${match.result}`}>
                          <strong>{match.result === "win" ? "WIN" : "LOSS"}</strong>
                          <button className="history-opponent" onClick={() => setSelectedOpponent(match.players.find((player) => player.uid === match.opponentUid) ?? null)}>
                            {match.opponentName}
                          </button>
                          <span className={match.eloDelta >= 0 ? "positive" : "negative"}>
                            {match.eloDelta >= 0 ? "+" : ""}{match.eloDelta} ELO
                          </span>
                          <button onClick={() => setSelectedReplay(match)}>{homeText.replay}</button>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            ) : (
              <section className="profile-summary logged-out-summary" aria-label="Account">
                <div className="account-card-heading">
                  <span>{homeText.account}</span>
                  <strong>{homeText.login}</strong>
                </div>
                <p className="auth-muted">{homeText.loginSave}</p>
                <button className="secondary-button" onClick={() => setAccountOpen(true)}>{homeText.login}</button>
              </section>
            )}
          </section>

          <section className="side-leaderboard-card">
            <div className="side-leaderboard-head">
              <div>
                <span>{homeText.leaderboard}</span>
                <strong>{homeText.top50}</strong>
              </div>
              <button onClick={() => void refreshLeaderboard()} disabled={leaderboardLoading}>{homeText.refresh}</button>
            </div>

            {currentUser && currentRank && (
              <div className="my-rank-card">
                <span>{homeText.profile}</span>
                <strong>#{currentRank.rank}</strong>
                <small>{rankPlacement} - {currentRank.elo} ELO</small>
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

      {selectedReplay && <ReplayPreview match={selectedReplay} onClose={() => setSelectedReplay(null)} />}
      {selectedOpponent && (
        <section className="home-modal-backdrop profile-preview-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedOpponent(null);
        }}>
          <div className="home-modal profile-preview-modal" role="dialog" aria-modal="true">
            <button className="modal-close-button" onClick={() => setSelectedOpponent(null)}>x</button>
            <div className="profile-preview-body">
              <span className={`profile-avatar ${selectedOpponent.profileColor}`}>
                <img src={profilePictureUrl(selectedOpponent.avatarId)} alt="" />
              </span>
              <span className="profile-label">{homeText.profile}</span>
              <strong>{selectedOpponent.displayName}</strong>
              <small>@{selectedOpponent.publicId}</small>
              <b>ELO {selectedOpponent.startingElo}</b>
            </div>
          </div>
        </section>
      )}

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
