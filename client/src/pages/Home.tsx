import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { socket } from "../socket";
import { t } from "../i18n";
import { useAuth } from "../auth/AuthContext";
import { canUseRankedMatchmaking } from "../auth/rankedAccess";
import type { ClientPlayerProfile } from "../../../shared/types";
import { cancelRanked, enqueueRanked, getRankedStatus } from "../rankedApi";
import { PROFILE_PICTURE_IDS, profilePictureUrl } from "../profilePictures";
import type { AiDifficulty } from "../../../shared/types";

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

type PlayModeCardProps = {
  label: string;
  subtitle: string;
  variant?: "primary";
  onClick: () => void;
};

function PlayModeCard({ label, subtitle, variant, onClick }: PlayModeCardProps) {
  return (
    <button className={`play-mode-card ${variant === "primary" ? "primary-mode" : ""}`} onClick={onClick}>
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
    socket.emit("create-room", { profile: playerProfilePayload() });
  }

  function joinRoom() {
    if (!roomCode.trim()) return;
    socket.emit("join-room", { roomId: roomCode.trim().toUpperCase(), profile: playerProfilePayload() });
  }

  async function openRanked() {
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
    setModeMessage("Searching for ranked opponent...");
    setSearchMode("ranked");
    setSearchStartedAt(Date.now());
    setRankedElapsed(0);

    try {
      const result = await enqueueRanked(currentUser);
      if (result.status === "matched" && result.matchId) {
        setRankedMatchId(result.matchId);
        setModeMessage("Ranked match found. Entering game...");
      }
    } catch (err) {
      setSearchMode(null);
      setModeMessage(err instanceof Error ? err.message : "Could not start ranked search.");
    }
  }

  function openCasual() {
    setRankedMatchId(null);
    setActivePanel("casual");
    setModeMessage(null);
    setSearchMode("casual");
    socket.emit("casual-search", { profile: playerProfilePayload() });
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
    socket.emit("create-ai-room", { profile: playerProfilePayload(), difficulty });
  }

  function openFriend() {
    setSearchMode(null);
    setModeMessage(null);
    setActivePanel("friend");
  }

  async function cancelSearch() {
    if (searchMode === "ranked" && currentUser) {
      await cancelRanked(currentUser).catch(() => undefined);
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
      void enqueueRanked(currentUser)
        .then((result) => {
          if (result.status === "matched" && result.matchId) {
            setRankedMatchId(result.matchId);
            setModeMessage("Ranked match found. Entering game...");
          }
        })
        .catch((err) => {
          setSearchMode(null);
          setModeMessage(err instanceof Error ? err.message : "Ranked search failed.");
        });

      void getRankedStatus(currentUser).then((result) => {
        if (result.status === "matched" && result.matchId) {
          setRankedMatchId(result.matchId);
          setModeMessage("Ranked match found. Entering game...");
        }
      });
    }, 2_500);

    return () => window.clearInterval(timer);
  }, [currentUser, rankedMatchId, searchMode]);

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
              <p className="eyebrow">Wallz arena</p>
              <h1>{t.title}</h1>
              <p>{t.subtitle}</p>
            </div>
            <div className="season-pill">
              <span>Online</span>
              <strong>Phase 2</strong>
            </div>
          </div>

          <div className="play-grid">
            <PlayModeCard label="Play" subtitle="Ranked match - login required" variant="primary" onClick={openRanked} />
            <PlayModeCard label="Casual" subtitle="Unranked - no login needed" onClick={openCasual} />
            <PlayModeCard label="Play Computer" subtitle="Practice mode" onClick={openComputer} />
            <PlayModeCard label="Play a Friend" subtitle="Create or join by room code" onClick={openFriend} />
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

          {activePanel === "friend" && (
            <section className="friend-room-panel">
              <div>
                <h2>Play a Friend</h2>
                <p>Friend matches are unranked and do not update profile stats.</p>
              </div>
              <button className="primary-button" onClick={createRoom}>
                Create room
              </button>
              <div className="join-box">
                <input value={roomCode} onChange={(event) => setRoomCode(event.target.value)} placeholder={t.roomCode} maxLength={5} />
                <button onClick={joinRoom}>{t.joinRoom}</button>
              </div>
            </section>
          )}

          {activePanel === "computer" && (
            <section className="friend-room-panel computer-panel">
              <div>
                <h2>Play Computer</h2>
                <p>Unranked practice. Pro bot evaluates walls and is built to be brutal.</p>
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
              <button className="primary-button" onClick={() => startComputer()}>
                Start {AI_DIFFICULTIES.find((difficulty) => difficulty.id === aiDifficulty)?.label ?? "Normal"}
              </button>
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

          <section className="home-lobby-panel">
            <div className="panel-head">
              <span>Lobby</span>
              <strong>128 online</strong>
            </div>
            <div className="lobby-list">
              <div>
                <strong>Ranked queue</strong>
                <small>Coming after matchmaking</small>
              </div>
              <div>
                <strong>Open friend rooms</strong>
                <small>Use a room code for now</small>
              </div>
              <div>
                <strong>Casual pool</strong>
                <small>Placeholder only</small>
              </div>
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}
