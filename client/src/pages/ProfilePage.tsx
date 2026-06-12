import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { MoveRecord, PlayerId, Position, Wall } from "../../../shared/types";
import { useAuth } from "../auth/AuthContext";
import { PROFILE_PICTURE_IDS, profilePictureUrl } from "../profilePictures";
import type { MatchHistoryRecord } from "../matchHistoryApi";
import { deleteOwnAccount, getOwnProfile, getPublicProfile, updateOwnProfile } from "../profileApi";
import type { ProfileResponse, PublicProfile } from "../profileApi";

type Props = {
  mode: "own" | "public";
  identifier?: string;
  onGoHome: () => void;
};

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
    const timer = window.setTimeout(() => setStep((value) => Math.min(moves.length, value + 1)), 700);
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
          <span>Replay</span>
          <strong>vs {match.opponentName}</strong>
        </div>
        <div className="replay-board">
          {Array.from({ length: boardSize * boardSize }, (_, index) => {
            const row = Math.floor(index / boardSize);
            const col = index % boardSize;
            const pawn = replayState.positions.P1.row === row && replayState.positions.P1.col === col ? "P1" : replayState.positions.P2.row === row && replayState.positions.P2.col === col ? "P2" : null;
            return <div key={`${row}-${col}`} className="replay-cell">{pawn && <span className={`replay-pawn ${pawn === "P1" ? "blue" : "red"}`} />}</div>;
          })}
          {replayState.walls.map((wall, index) => (
            <span key={`${wall.row}-${wall.col}-${wall.orientation}-${index}`} className={`replay-wall ${wall.orientation === "H" ? "horizontal" : "vertical"}`} style={{ "--wall-row": wall.row, "--wall-col": wall.col } as CSSProperties} />
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

function formSymbols(history: MatchHistoryRecord[]) {
  return history.slice(0, 5);
}

export default function ProfilePage({ mode, identifier, onGoHome }: Props) {
  const { currentUser, logout, refreshProfile } = useAuth();
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [publicId, setPublicId] = useState("");
  const [avatarId, setAvatarId] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [selectedReplay, setSelectedReplay] = useState<MatchHistoryRecord | null>(null);

  const isOwn = mode === "own";
  const profile: PublicProfile | null = data?.profile ?? null;
  const history = data?.history ?? [];

  async function loadProfile() {
    setError(null);
    try {
      const nextData = isOwn
        ? currentUser ? await getOwnProfile(currentUser) : null
        : identifier ? await getPublicProfile(identifier) : null;
      setData(nextData);
      if (nextData) {
        setPublicId(nextData.profile.publicId);
        setAvatarId(nextData.profile.avatarId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load profile.");
    }
  }

  useEffect(() => {
    void loadProfile();
  }, [currentUser?.uid, identifier, mode]);

  async function saveProfile() {
    if (!currentUser) return;
    setBusy(true);
    setError(null);
    try {
      const nextData = await updateOwnProfile(currentUser, { publicId, avatarId });
      setData(nextData);
      await refreshProfile();
      setEditOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update profile.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!currentUser) return;
    setBusy(true);
    setError(null);
    try {
      await deleteOwnAccount(currentUser, "DELETE");
      await logout();
      onGoHome();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete account.");
    } finally {
      setBusy(false);
    }
  }

  if (!profile) {
    return (
      <main className="profile-page">
        <button className="home-button" onClick={onGoHome}>XAHA</button>
        <p className="error-text">{error ?? "Loading profile..."}</p>
      </main>
    );
  }

  return (
    <main className="profile-page">
      <header className="profile-topbar">
        <button onClick={onGoHome}>XAHA</button>
        {isOwn && <button onClick={() => setEditOpen(true)}>Edit</button>}
      </header>

      <section className="profile-hero-bar">
        <div className="profile-stat-left">
          <span className={`profile-avatar ${profile.profileColor}`}><img src={profilePictureUrl(profile.avatarId)} alt="" /></span>
          <div>
            <span className="profile-label">Your stats</span>
            <strong>{profile.displayName}</strong>
          </div>
          <h1>{profile.elo}</h1>
          <p><b>{profile.wins}W</b> / <b className="loss">{profile.losses}L</b></p>
          <div className="profile-rank-line">
            <span>#{profile.rank ?? "-"}</span>
            <small>of {profile.totalPlayers} players</small>
            <em>{profile.winRate}% win rate</em>
          </div>
          <div className="profile-winbar"><span style={{ width: `${profile.winRate}%` }} /></div>
          <div className="profile-form-row">
            <span>FORM</span>
            {formSymbols(history).map((match) => <b key={match.matchId} className={match.result}>{match.result === "win" ? "W" : "L"}</b>)}
          </div>
        </div>

        <div className="profile-history-panel">
          {history.slice(0, 20).map((match) => (
            <article key={match.matchId} className={`profile-history-row ${match.result}`}>
              <strong>{match.result === "win" ? "WIN" : "LOSS"}</strong>
              <span className={`mini-avatar ${match.result === "win" ? "blue" : "red"}`} />
              <button onClick={() => {
                window.history.pushState(null, "", `/user/${encodeURIComponent(match.opponentPublicId)}`);
                window.dispatchEvent(new PopStateEvent("popstate"));
              }}>{match.opponentName}</button>
              <em className={match.eloDelta >= 0 ? "positive" : "negative"}>{match.eloDelta >= 0 ? "+" : ""}{match.eloDelta}</em>
              <button onClick={() => setSelectedReplay(match)}>Replay</button>
            </article>
          ))}
          {history.length === 0 && <p className="leaderboard-empty compact">No ranked match history yet.</p>}
        </div>
      </section>

      {error && <p className="error-text">{error}</p>}

      {editOpen && (
        <section className="home-modal-backdrop">
          <div className="home-modal profile-edit-modal">
            <button className="modal-close-button" onClick={() => setEditOpen(false)}>x</button>
            <div className="modal-heading"><span>Edit</span><strong>Profile</strong></div>
            <input value={publicId} onChange={(event) => setPublicId(event.target.value)} placeholder="Public ID" />
            <div className="avatar-picker">
              {PROFILE_PICTURE_IDS.map((id) => (
                <button key={id} className={avatarId === id ? "active" : ""} onClick={() => setAvatarId(id)}>
                  <img src={profilePictureUrl(id)} alt="" />
                </button>
              ))}
            </div>
            <p className="auth-muted">Profile photo and ID can be changed once per week.</p>
            <button className="secondary-button" onClick={saveProfile} disabled={busy}>Save</button>
            <button className="delete-account-button" onClick={() => setDeleteOpen(true)}>Delete account</button>
          </div>
        </section>
      )}

      {deleteOpen && (
        <section className="home-modal-backdrop">
          <div className="home-modal delete-modal">
            <button className="modal-close-button" onClick={() => setDeleteOpen(false)}>x</button>
            <div className="modal-heading"><span>Danger</span><strong>Delete account?</strong></div>
            <p className="auth-muted">This deletes your Auth account, profile, public ID reservation, queue entry, and saved match history. This cannot be undone.</p>
            <input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} placeholder="Type DELETE to confirm" />
            <button className="delete-account-button" onClick={confirmDelete} disabled={busy || deleteConfirmation !== "DELETE"}>Confirm DELETE</button>
          </div>
        </section>
      )}

      {selectedReplay && <ReplayPreview match={selectedReplay} onClose={() => setSelectedReplay(null)} />}
    </main>
  );
}
