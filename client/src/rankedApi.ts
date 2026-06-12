import type { User } from "firebase/auth";
import type { TimeControlId } from "../../shared/types";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:4000";

async function rankedRequest<T>(user: User, path: string, init: RequestInit = {}): Promise<T> {
  const token = await user.getIdToken();
  const response = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error ?? "Ranked request failed.");
  }
  return data as T;
}

export type RankedQueueResponse = {
  status: "idle" | "searching" | "matched" | "cancelled";
  matchId: string | null;
};

export type RankedFinalizeResponse = {
  alreadyApplied: boolean;
  winnerUid: string;
  loserUid: string;
  eloChange: { winner: number; loser: number };
  winner?: { before: number; after: number; delta: number };
  loser?: { before: number; after: number; delta: number };
};

export function enqueueRanked(user: User, timeControlId: TimeControlId): Promise<RankedQueueResponse> {
  return rankedRequest(user, "/ranked/enqueue", { method: "POST", body: JSON.stringify({ timeControlId }) });
}

export function getRankedStatus(user: User): Promise<RankedQueueResponse> {
  return rankedRequest(user, "/ranked/status");
}

export function cancelRanked(user: User): Promise<RankedQueueResponse> {
  return rankedRequest(user, "/ranked/cancel", { method: "POST", body: "{}" });
}

export function cancelRankedWithToken(idToken: string): void {
  void fetch(`${SERVER_URL}/ranked/cancel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: "{}",
    keepalive: true,
  }).catch(() => undefined);
}

export function finalizeRanked(user: User, matchId: string, winnerUid: string, loserUid: string): Promise<RankedFinalizeResponse> {
  return rankedRequest(user, "/ranked/finalize", {
    method: "POST",
    body: JSON.stringify({ matchId, winnerUid, loserUid }),
  });
}
