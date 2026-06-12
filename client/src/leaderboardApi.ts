import type { User } from "firebase/auth";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:4000";

export type LeaderboardPlayer = {
  rank: number;
  uid: string;
  displayName: string;
  publicId: string;
  avatarId: string;
  profileColor: string;
  elo: number;
  wins: number;
  losses: number;
  rankedMatches: number;
  winRate: number;
};

export type LeaderboardResponse = {
  players: LeaderboardPlayer[];
  currentPlayer: LeaderboardPlayer | null;
};

export async function getLeaderboard(limit = 50, user?: User | null): Promise<LeaderboardResponse> {
  const token = user ? await user.getIdToken() : null;
  const response = await fetch(`${SERVER_URL}/leaderboard?limit=${limit}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Could not load leaderboard.");
  return {
    players: Array.isArray(data.players) ? data.players : [],
    currentPlayer: data.currentPlayer ?? null,
  };
}
