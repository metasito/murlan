export interface AuthUser {
  id: string;
  username: string;
  /** When this account first opened the tutorial, on any device; null if never. */
  tutorialSeenAt?: string | null;
  /** Null for an account that predates the email requirement (#861) — see lib/emailNudge.ts. */
  email?: string | null;
  emailVerified?: boolean;
}

const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";

/**
 * The cache may predate any field but `id` and `username`. A field that is
 * missing or of the wrong type stays absent — unknown until /api/auth/me
 * answers — because `false` or `null` would assert something nobody said.
 */
export function parseCachedUser(raw: string | null): AuthUser | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const v = parsed as Record<string, unknown>;
  if (typeof v.id !== "string" || typeof v.username !== "string") return null;
  const user: AuthUser = { id: v.id, username: v.username };
  if (isStringOrNull(v.tutorialSeenAt)) user.tutorialSeenAt = v.tutorialSeenAt;
  if (isStringOrNull(v.email)) user.email = v.email;
  if (typeof v.emailVerified === "boolean") user.emailVerified = v.emailVerified;
  return user;
}
