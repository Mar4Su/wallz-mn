import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";
import type { User } from "firebase/auth";
import { doc, getDoc, runTransaction, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import type { FieldValue, Timestamp } from "firebase/firestore";
import { auth, db, firebaseConfigError } from "../firebase";
import { isProfilePictureId, randomProfilePictureId } from "../profilePictures";

const DEFAULT_PROFILE_COLOR = "blue";
const USERNAME_PATTERN = /^[a-z0-9_-]{3,16}$/;
const PROFILE_SETUP_FAILED_MESSAGE = "Account was created, but profile setup failed. Please contact support or try logging in again.";

export type UserProfile = {
  uid: string;
  email: string;
  displayName: string;
  publicId: string;
  elo: number;
  wins: number;
  losses: number;
  rankedMatches: number;
  avatarId: string;
  profileColor: string;
  linkedProviders: string[];
  createdAt: Timestamp | FieldValue | null;
  updatedAt: Timestamp | FieldValue | null;
};

type AuthContextValue = {
  currentUser: User | null;
  profile: UserProfile | null;
  loading: boolean;
  authReady: boolean;
  configError: string | null;
  signupWithEmail: (email: string, password: string, displayName: string) => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateAvatarId: (avatarId: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function publicIdFromUid(uid: string): string {
  return `user-${uid.slice(0, 8).toLowerCase()}`;
}

export function normalizePublicId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(normalized)) {
    throw new Error("Username must be 3-16 characters and use only letters, numbers, underscore, or hyphen.");
  }
  return normalized;
}

function displayNameFromUser(user: User, fallback?: string): string {
  const trimmedFallback = fallback?.trim();
  if (trimmedFallback) return trimmedFallback;
  if (user.displayName?.trim()) return user.displayName.trim();
  return user.email?.split("@")[0] || "Player";
}

function buildDefaultProfile(user: User, displayName?: string, publicId?: string): UserProfile {
  const resolvedPublicId = publicId ?? publicIdFromUid(user.uid);
  return {
    uid: user.uid,
    email: user.email ?? "",
    displayName: displayNameFromUser(user, displayName),
    publicId: resolvedPublicId,
    elo: 1000,
    wins: 0,
    losses: 0,
    rankedMatches: 0,
    avatarId: randomProfilePictureId(),
    profileColor: DEFAULT_PROFILE_COLOR,
    linkedProviders: ["password"],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

async function ensureUserProfile(user: User, displayName?: string): Promise<UserProfile> {
  if (!db) {
    throw new Error(firebaseConfigError ?? "Firestore is not available.");
  }

  const ref = doc(db, "users", user.uid);
  const snapshot = await getDoc(ref);

  if (snapshot.exists()) {
    return snapshot.data() as UserProfile;
  }

  const profile = buildDefaultProfile(user, displayName);
  const publicIdRef = doc(db, "publicIds", profile.publicId);
  await runTransaction(db, async (transaction) => {
    const publicIdSnapshot = await transaction.get(publicIdRef);
    if (publicIdSnapshot.exists() && publicIdSnapshot.data().uid !== user.uid) {
      throw new Error("This username is already taken.");
    }

    if (!publicIdSnapshot.exists()) {
      transaction.set(publicIdRef, {
        uid: user.uid,
        publicId: profile.publicId,
        createdAt: serverTimestamp(),
      });
    }

    transaction.set(ref, profile);
  });
  return profile;
}

async function loadUserProfile(user: User): Promise<UserProfile | null> {
  if (!db) {
    throw new Error(firebaseConfigError ?? "Firestore is not available.");
  }

  const snapshot = await getDoc(doc(db, "users", user.uid));
  return snapshot.exists() ? (snapshot.data() as UserProfile) : null;
}

async function createProfileWithReservedPublicId(user: User, displayName: string): Promise<UserProfile> {
  if (!db) {
    throw new Error(firebaseConfigError ?? "Firestore is not available.");
  }

  const publicId = normalizePublicId(displayName);
  const profile = buildDefaultProfile(user, publicId, publicId);
  const userRef = doc(db, "users", user.uid);
  const publicIdRef = doc(db, "publicIds", publicId);

  await runTransaction(db, async (transaction) => {
    const publicIdSnapshot = await transaction.get(publicIdRef);
    if (publicIdSnapshot.exists()) {
      throw new Error("This username is already taken.");
    }

    transaction.set(publicIdRef, {
      uid: user.uid,
      publicId,
      createdAt: serverTimestamp(),
    });
    transaction.set(userRef, profile);
  });

  return profile;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(() => !!auth);
  const authReady = !!auth && !!db;

  async function refreshProfile() {
    if (!auth) return;
    if (!auth.currentUser) {
      setProfile(null);
      return;
    }

    const nextProfile = await ensureUserProfile(auth.currentUser);
    setProfile(nextProfile);
  }

  async function signupWithEmail(email: string, password: string, displayName: string) {
    if (!auth) {
      throw new Error(firebaseConfigError ?? "Firebase Auth is not available.");
    }

    const publicId = normalizePublicId(displayName);
    const credential = await createUserWithEmailAndPassword(auth, email, password);

    try {
      await updateProfile(credential.user, { displayName: publicId });
      const nextProfile = await createProfileWithReservedPublicId(credential.user, publicId);
      await sendEmailVerification(credential.user);
      setCurrentUser(credential.user);
      setProfile(nextProfile);
    } catch (err) {
      if (err instanceof Error && err.message === "This username is already taken.") {
        throw err;
      }

      throw new Error(PROFILE_SETUP_FAILED_MESSAGE);
    }
  }

  async function loginWithEmail(email: string, password: string) {
    if (!auth) {
      throw new Error(firebaseConfigError ?? "Firebase Auth is not available.");
    }

    const credential = await signInWithEmailAndPassword(auth, email, password);
    const nextProfile = await ensureUserProfile(credential.user);
    setCurrentUser(credential.user);
    setProfile(nextProfile);
  }

  async function logout() {
    if (!auth) return;
    await signOut(auth);
    setCurrentUser(null);
    setProfile(null);
  }

  async function updateAvatarId(avatarId: string) {
    if (!auth?.currentUser || !db) {
      throw new Error("You must be logged in to change your picture.");
    }
    if (!auth.currentUser.emailVerified) {
      throw new Error("Please verify your email before changing your picture.");
    }
    if (!isProfilePictureId(avatarId)) {
      throw new Error("Invalid profile picture.");
    }

    await updateDoc(doc(db, "users", auth.currentUser.uid), {
      avatarId,
      updatedAt: serverTimestamp(),
    });
    await refreshProfile();
  }

  useEffect(() => {
    if (!auth) {
      setCurrentUser(null);
      setProfile(null);
      setLoading(false);
      return;
    }

    return onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);

      try {
        setProfile(user ? await loadUserProfile(user) : null);
      } catch {
        setProfile(null);
      } finally {
        setLoading(false);
      }
    });
  }, []);

  const value = useMemo(
    () => ({
      currentUser,
      profile,
      loading,
      authReady,
      configError: firebaseConfigError,
      signupWithEmail,
      loginWithEmail,
      logout,
      refreshProfile,
      updateAvatarId,
    }),
    [currentUser, profile, loading, authReady]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return value;
}
