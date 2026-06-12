import type { User } from "firebase/auth";
import type { MatchHistoryRecord } from "./matchHistoryApi";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:4000";

export type PublicProfile = {
  uid: string;
  displayName: string;
  publicId: string;
  elo: number;
  wins: number;
  losses: number;
  rankedMatches: number;
  winRate: number;
  avatarId: string;
  profileColor: string;
  rank: number | null;
  totalPlayers: number;
};

export type ProfileResponse = {
  profile: PublicProfile;
  history: MatchHistoryRecord[];
};

async function authHeaders(user: User): Promise<HeadersInit> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${await user.getIdToken()}`,
  };
}

export async function getPublicProfile(identifier: string): Promise<ProfileResponse> {
  const response = await fetch(`${SERVER_URL}/users/${encodeURIComponent(identifier)}?limit=20`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Could not load profile.");
  return data as ProfileResponse;
}

export async function getOwnProfile(user: User): Promise<ProfileResponse> {
  const response = await fetch(`${SERVER_URL}/me/profile`, { headers: await authHeaders(user) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Could not load profile.");
  return data as ProfileResponse;
}

export async function updateOwnProfile(user: User, input: { publicId?: string; avatarId?: string }): Promise<ProfileResponse> {
  const response = await fetch(`${SERVER_URL}/me/profile`, {
    method: "PATCH",
    headers: await authHeaders(user),
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Could not update profile.");
  return data as ProfileResponse;
}

export async function deleteOwnAccount(user: User, confirmation: string): Promise<void> {
  const response = await fetch(`${SERVER_URL}/me/delete`, {
    method: "POST",
    headers: await authHeaders(user),
    body: JSON.stringify({ confirmation }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Could not delete account.");
}
