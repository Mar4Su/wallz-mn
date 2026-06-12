import type { User } from "firebase/auth";

export function canUseRankedMatchmaking(user: User | null): boolean {
  return !!user && user.emailVerified;
}
