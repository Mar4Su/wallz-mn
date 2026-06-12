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

export async function getLeaderboard(limit = 25): Promise<LeaderboardPlayer[]> {
  const response = await fetch(`${SERVER_URL}/leaderboard?limit=${limit}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Could not load leaderboard.");
  return Array.isArray(data.players) ? data.players : [];
}
