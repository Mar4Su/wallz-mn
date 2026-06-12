import type { DecodedIdToken } from "firebase-admin/auth";
import type { DocumentData, FieldValue, Timestamp, Transaction } from "firebase-admin/firestore";
import { adminAuth, adminDb, adminFieldValue } from "./firebaseAdmin";

const K_FACTOR = 32;
const MIN_ELO = 100;
const DEFAULT_AVATAR_ID = "-1.png";

export type RankedPlayer = {
  uid: string;
  displayName: string;
  publicId: string;
  avatarId: string;
  profileColor: string;
  startingElo: number;
};

export type RankedMatchDoc = {
  matchId: string;
  type: "ranked";
  status: "active" | "finished" | "cancelled";
  playerUids: string[];
  players: RankedPlayer[];
  winnerUid: string | null;
  loserUid: string | null;
  eloApplied: boolean;
  eloChange: { winner: number; loser: number };
  matchMode: "classic";
  createdAt: FieldValue | Timestamp;
  finishedAt: FieldValue | Timestamp | null;
};

type QueueDoc = {
  uid: string;
  elo: number;
  displayName: string;
  publicId: string;
  avatarId: string;
  profileColor: string;
  status: "searching" | "matched" | "cancelled";
  matchId: string | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

export async function verifyBearerToken(header: string | undefined): Promise<DecodedIdToken> {
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!token) throw new Error("Missing auth token.");
  return adminAuth.verifyIdToken(token);
}

function eloWindow(elapsedMs: number): number | null {
  if (elapsedMs < 10_000) return 100;
  if (elapsedMs < 20_000) return 200;
  if (elapsedMs < 30_000) return 400;
  return null;
}

function expectedScore(eloA: number, eloB: number): number {
  return 1 / (1 + 10 ** ((eloB - eloA) / 400));
}

function newElo(current: number, opponent: number, score: 0 | 1): number {
  return Math.max(MIN_ELO, Math.round(current + K_FACTOR * (score - expectedScore(current, opponent))));
}

function queueFromProfile(uid: string, profile: DocumentData): QueueDoc {
  return {
    uid,
    elo: Number(profile.elo ?? 1000),
    displayName: String(profile.displayName ?? profile.publicId ?? "Player"),
    publicId: String(profile.publicId ?? uid.slice(0, 8)),
    avatarId: String(profile.avatarId ?? DEFAULT_AVATAR_ID),
    profileColor: String(profile.profileColor ?? "blue"),
    status: "searching",
    matchId: null,
  };
}

function playerFromQueue(queue: QueueDoc): RankedPlayer {
  return {
    uid: queue.uid,
    displayName: queue.displayName,
    publicId: queue.publicId,
    avatarId: queue.avatarId,
    profileColor: queue.profileColor,
    startingElo: queue.elo,
  };
}

export async function enqueueRanked(decoded: DecodedIdToken) {
  const user = await adminAuth.getUser(decoded.uid);
  if (!user.emailVerified) throw new Error("Please verify your email before playing ranked.");

  const userRef = adminDb.collection("users").doc(decoded.uid);
  const userSnapshot = await userRef.get();
  if (!userSnapshot.exists) throw new Error("Profile not found.");

  const ownQueue = queueFromProfile(decoded.uid, userSnapshot.data() ?? {});
  const ownQueueRef = adminDb.collection("matchmakingQueue").doc(decoded.uid);
  const matchRef = adminDb.collection("matches").doc();

  return adminDb.runTransaction(async (transaction: Transaction) => {
    const now = Date.now();
    const ownQueueSnapshot = await transaction.get(ownQueueRef);
    const previousQueue = ownQueueSnapshot.exists ? (ownQueueSnapshot.data() as QueueDoc) : null;
    const createdAt = previousQueue?.status === "searching" && previousQueue.createdAt ? previousQueue.createdAt : adminFieldValue.serverTimestamp();
    const previousCreatedMs = previousQueue?.createdAt?.toMillis() ?? now;
    const window = eloWindow(now - previousCreatedMs);

    const queueQuery = adminDb.collection("matchmakingQueue").where("status", "==", "searching").limit(50);
    const queueSnapshot = await transaction.get(queueQuery);
    const candidates = queueSnapshot.docs
      .filter((doc) => doc.id !== decoded.uid)
      .map((doc) => doc.data() as QueueDoc)
      .filter((candidate: QueueDoc) => candidate.uid !== decoded.uid)
      .filter((candidate: QueueDoc) => window === null || Math.abs(candidate.elo - ownQueue.elo) <= window)
      .sort((a: QueueDoc, b: QueueDoc) => Math.abs(a.elo - ownQueue.elo) - Math.abs(b.elo - ownQueue.elo));

    const opponent = candidates[0];
    if (!opponent) {
      transaction.set(
        ownQueueRef,
        {
          ...ownQueue,
          createdAt,
          updatedAt: adminFieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return { status: "searching" as const, matchId: previousQueue?.matchId ?? null };
    }

    const opponentQueueRef = adminDb.collection("matchmakingQueue").doc(opponent.uid);
    const opponentSnapshot = await transaction.get(opponentQueueRef);
    const latestOpponent = opponentSnapshot.data() as QueueDoc | undefined;
    if (!latestOpponent || latestOpponent.status !== "searching" || latestOpponent.uid === decoded.uid) {
      transaction.set(
        ownQueueRef,
        {
          ...ownQueue,
          createdAt,
          updatedAt: adminFieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return { status: "searching" as const, matchId: null };
    }

    const matchId = matchRef.id;
    const match: RankedMatchDoc = {
      matchId,
      type: "ranked",
      status: "active",
      playerUids: [decoded.uid, latestOpponent.uid],
      players: [playerFromQueue(ownQueue), playerFromQueue(latestOpponent)],
      winnerUid: null,
      loserUid: null,
      eloApplied: false,
      eloChange: { winner: 0, loser: 0 },
      matchMode: "classic",
      createdAt: adminFieldValue.serverTimestamp(),
      finishedAt: null,
    };

    transaction.set(matchRef, match);
    transaction.set(
      ownQueueRef,
      {
        ...ownQueue,
        createdAt,
        updatedAt: adminFieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    transaction.update(ownQueueRef, { status: "matched", matchId, updatedAt: adminFieldValue.serverTimestamp() });
    transaction.update(opponentQueueRef, { status: "matched", matchId, updatedAt: adminFieldValue.serverTimestamp() });

    return { status: "matched" as const, matchId };
  });
}

export async function getRankedStatus(decoded: DecodedIdToken) {
  const queueSnapshot = await adminDb.collection("matchmakingQueue").doc(decoded.uid).get();
  if (!queueSnapshot.exists) return { status: "idle", matchId: null };
  const queue = queueSnapshot.data() as QueueDoc;
  return { status: queue.status, matchId: queue.matchId ?? null };
}

export async function cancelRanked(decoded: DecodedIdToken) {
  await adminDb.collection("matchmakingQueue").doc(decoded.uid).set(
    {
      uid: decoded.uid,
      status: "cancelled",
      matchId: null,
      updatedAt: adminFieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return { status: "cancelled" };
}

export async function getRankedMatch(matchId: string): Promise<RankedMatchDoc | null> {
  const snapshot = await adminDb.collection("matches").doc(matchId).get();
  return snapshot.exists ? (snapshot.data() as RankedMatchDoc) : null;
}

export async function finalizeRankedMatch(decoded: DecodedIdToken, matchId: string, winnerUid: string, loserUid: string) {
  const matchRef = adminDb.collection("matches").doc(matchId);

  return adminDb.runTransaction(async (transaction: Transaction) => {
    const matchSnapshot = await transaction.get(matchRef);
    if (!matchSnapshot.exists) throw new Error("Match not found.");
    const match = matchSnapshot.data() as RankedMatchDoc;
    if (!match.playerUids.includes(decoded.uid)) throw new Error("Not a player in this match.");
    if (!match.playerUids.includes(winnerUid) || !match.playerUids.includes(loserUid) || winnerUid === loserUid) {
      throw new Error("Invalid ranked result.");
    }

    const winner = match.players.find((player) => player.uid === winnerUid);
    const loser = match.players.find((player) => player.uid === loserUid);
    if (!winner || !loser) throw new Error("Missing match players.");

    if (match.eloApplied) {
      const winnerDelta = match.eloChange?.winner ?? 0;
      const loserDelta = match.eloChange?.loser ?? 0;
      return {
        alreadyApplied: true,
        winnerUid: match.winnerUid,
        loserUid: match.loserUid,
        eloChange: match.eloChange,
        winner: { before: winner.startingElo, after: winner.startingElo + winnerDelta, delta: winnerDelta },
        loser: { before: loser.startingElo, after: Math.max(MIN_ELO, loser.startingElo + loserDelta), delta: loserDelta },
      };
    }

    const winnerNewElo = newElo(winner.startingElo, loser.startingElo, 1);
    const loserNewElo = newElo(loser.startingElo, winner.startingElo, 0);
    const winnerDelta = winnerNewElo - winner.startingElo;
    const loserDelta = loserNewElo - loser.startingElo;

    transaction.update(adminDb.collection("users").doc(winnerUid), {
      elo: winnerNewElo,
      wins: adminFieldValue.increment(1),
      rankedMatches: adminFieldValue.increment(1),
      updatedAt: adminFieldValue.serverTimestamp(),
    });
    transaction.update(adminDb.collection("users").doc(loserUid), {
      elo: loserNewElo,
      losses: adminFieldValue.increment(1),
      rankedMatches: adminFieldValue.increment(1),
      updatedAt: adminFieldValue.serverTimestamp(),
    });
    transaction.update(matchRef, {
      status: "finished",
      winnerUid,
      loserUid,
      eloApplied: true,
      eloChange: { winner: winnerDelta, loser: loserDelta },
      finishedAt: adminFieldValue.serverTimestamp(),
    });

    return {
      alreadyApplied: false,
      winnerUid,
      loserUid,
      eloChange: { winner: winnerDelta, loser: loserDelta },
      winner: { before: winner.startingElo, after: winnerNewElo, delta: winnerDelta },
      loser: { before: loser.startingElo, after: loserNewElo, delta: loserDelta },
    };
  });
}
