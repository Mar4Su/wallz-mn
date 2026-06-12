import type { User } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../firebase";

export async function updateMatchPresence(roomId: string, user: User, connected: boolean): Promise<void> {
  if (!db) return;

  await setDoc(
    doc(db, "matches", roomId, "presence", user.uid),
    {
      uid: user.uid,
      connected,
      lastSeenAt: serverTimestamp(),
    },
    { merge: true }
  );
}
