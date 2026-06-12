import type { User } from "firebase/auth";
import type { MoveRecord, TimeControlId } from "../../shared/types";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:4000";

export type MatchHistoryPlayer = {
  uid: string;
  displayName: string;
  publicId: string;
  avatarId: string;
  profileColor: string;
  startingElo: number;
};

export type MatchHistoryRecord = {
  matchId: string;
  result: "win" | "loss";
  opponentUid: string;
  opponentName: string;
  opponentPublicId: string;
  eloBefore: number;
  eloAfter: number;
  eloDelta: number;
  moves: MoveRecord[];
  players: MatchHistoryPlayer[];
  timeControlId: TimeControlId;
};

export async function getMyMatchHistory(user: User, limit = 8): Promise<MatchHistoryRecord[]> {
  const token = await user.getIdToken();
  const response = await fetch(`${SERVER_URL}/me/history?limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Could not load match history.");
  return Array.isArray(data.matches) ? data.matches : [];
}
