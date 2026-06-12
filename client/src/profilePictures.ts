export const GUEST_AVATAR_ID = "-1.png";
export const PROFILE_PICTURE_IDS = ["-1.png", "-2.png", "-3.png", "-4.png", "-5.png", "-6.png"] as const;
const ACCOUNT_PROFILE_PICTURE_IDS = PROFILE_PICTURE_IDS.filter((id) => id !== GUEST_AVATAR_ID);

const profilePictureUrls = new Map<string, string>(
  PROFILE_PICTURE_IDS.map((id) => [id, new URL(`../pfps/${id}`, import.meta.url).href])
);

export function randomProfilePictureId(): string {
  return ACCOUNT_PROFILE_PICTURE_IDS[Math.floor(Math.random() * ACCOUNT_PROFILE_PICTURE_IDS.length)];
}

export function profilePictureUrl(avatarId: string | undefined): string {
  return profilePictureUrls.get(avatarId ?? GUEST_AVATAR_ID) ?? profilePictureUrls.get(GUEST_AVATAR_ID)!;
}

export function isProfilePictureId(value: string): boolean {
  return PROFILE_PICTURE_IDS.includes(value as (typeof PROFILE_PICTURE_IDS)[number]);
}
