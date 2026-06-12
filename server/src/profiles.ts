import type { DecodedIdToken } from "firebase-admin/auth";
import type { DocumentData, FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminAuth, adminDb, adminFieldValue } from "./firebaseAdmin";
import { getLeaderboardRank, getUserMatchHistory } from "./ranked";

const USERNAME_PATTERN = /^[a-z0-9_-]{3,16}$/;
const PROFILE_EDIT_MS = 7 * 24 * 60 * 60 * 1000;

function normalizePublicId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(normalized)) {
    throw new Error("Username must be 3-16 characters and use only letters, numbers, underscore, or hyphen.");
  }
  return normalized;
}

function millisFromTimestamp(value: unknown): number | null {
  if (!value) return null;
  if (typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") return value.toMillis();
  return null;
}

function publicProfileFromDoc(uid: string, data: DocumentData, rank: number | null, totalPlayers: number) {
  const wins = Number(data.wins ?? 0);
  const losses = Number(data.losses ?? 0);
  const total = wins + losses;
  return {
    uid,
    displayName: String(data.displayName ?? data.publicId ?? "Player"),
    publicId: String(data.publicId ?? uid.slice(0, 8)),
    elo: Number(data.elo ?? 1000),
    wins,
    losses,
    rankedMatches: Number(data.rankedMatches ?? total),
    winRate: total === 0 ? 0 : Math.round((wins / total) * 100),
    avatarId: String(data.avatarId ?? "-1.png"),
    profileColor: String(data.profileColor ?? "blue"),
    rank,
    totalPlayers,
    avatarChangedAt: data.avatarChangedAt ?? null,
    publicIdChangedAt: data.publicIdChangedAt ?? null,
  };
}

export async function getPublicProfile(identifier: string, historyLimit = 20) {
  const normalized = identifier.trim().toLowerCase();
  let uid = identifier;
  const publicIdSnapshot = await adminDb.collection("publicIds").doc(normalized).get();
  if (publicIdSnapshot.exists) uid = String(publicIdSnapshot.data()?.uid ?? uid);

  const userSnapshot = await adminDb.collection("users").doc(uid).get();
  if (!userSnapshot.exists) throw new Error("Profile not found.");

  const rank = await getLeaderboardRank(userSnapshot.id);
  const totalSnapshot = await adminDb.collection("users").count().get();
  return {
    profile: publicProfileFromDoc(userSnapshot.id, userSnapshot.data() ?? {}, rank?.rank ?? null, totalSnapshot.data().count),
    history: await getUserMatchHistory(userSnapshot.id, historyLimit),
  };
}

export async function updateOwnProfile(decoded: DecodedIdToken, input: { publicId?: string; avatarId?: string }) {
  const userRef = adminDb.collection("users").doc(decoded.uid);
  const userSnapshot = await userRef.get();
  if (!userSnapshot.exists) throw new Error("Profile not found.");
  if (!decoded.email_verified) throw new Error("Please verify your email before editing your profile.");

  const user = userSnapshot.data() ?? {};
  const now = Date.now();
  const updates: Record<string, string | FieldValue | Timestamp> = { updatedAt: adminFieldValue.serverTimestamp() };

  if (input.avatarId && input.avatarId !== user.avatarId) {
    const lastAvatarChange = millisFromTimestamp(user.avatarChangedAt);
    if (lastAvatarChange && now - lastAvatarChange < PROFILE_EDIT_MS) throw new Error("You can change your profile picture once per week.");
    updates.avatarId = input.avatarId;
    updates.avatarChangedAt = adminFieldValue.serverTimestamp();
  }

  const currentPublicId = String(user.publicId ?? "");
  const nextPublicIdInput = input.publicId ? normalizePublicId(input.publicId) : null;
  if (nextPublicIdInput && nextPublicIdInput !== currentPublicId) {
    const nextPublicId = nextPublicIdInput;
    const lastPublicIdChange = millisFromTimestamp(user.publicIdChangedAt);
    if (lastPublicIdChange && now - lastPublicIdChange < PROFILE_EDIT_MS) throw new Error("You can change your ID once per week.");

    await adminDb.runTransaction(async (transaction) => {
      const nextPublicIdRef = adminDb.collection("publicIds").doc(nextPublicId);
      const nextPublicIdSnapshot = await transaction.get(nextPublicIdRef);
      if (nextPublicIdSnapshot.exists && nextPublicIdSnapshot.data()?.uid !== decoded.uid) throw new Error("This username is already taken.");

      const previousPublicId = currentPublicId;
      if (previousPublicId && previousPublicId !== nextPublicId) {
        transaction.delete(adminDb.collection("publicIds").doc(previousPublicId));
      }
      transaction.set(nextPublicIdRef, {
        uid: decoded.uid,
        publicId: nextPublicId,
        createdAt: adminFieldValue.serverTimestamp(),
      });
      transaction.update(userRef, {
        ...updates,
        displayName: nextPublicId,
        publicId: nextPublicId,
        publicIdChangedAt: adminFieldValue.serverTimestamp(),
      });
    });
    await adminAuth.updateUser(decoded.uid, { displayName: nextPublicId });
    return getPublicProfile(decoded.uid, 20);
  }

  if (Object.keys(updates).length > 1) await userRef.update(updates);
  return getPublicProfile(decoded.uid, 20);
}

export async function deleteOwnAccount(decoded: DecodedIdToken) {
  const userRef = adminDb.collection("users").doc(decoded.uid);
  const userSnapshot = await userRef.get();
  const publicId = String(userSnapshot.data()?.publicId ?? "");
  const historySnapshot = await userRef.collection("matchHistory").get();
  const batch = adminDb.batch();
  historySnapshot.docs.forEach((doc) => batch.delete(doc.ref));
  batch.delete(adminDb.collection("matchmakingQueue").doc(decoded.uid));
  if (publicId) batch.delete(adminDb.collection("publicIds").doc(publicId));
  batch.delete(userRef);
  await batch.commit();
  await adminAuth.deleteUser(decoded.uid);
  return { ok: true };
}
