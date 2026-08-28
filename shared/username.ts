// Read by `server/schemas.ts` and by the screens, so anything imported here is
// imported into the app bundle: keep it free of zod and drizzle.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;

/** Anchored, and deliberately not global: `.test` on a `/g` regex carries `lastIndex`. */
export const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;

export type UsernameProblem = "tooShort" | "tooLong" | "invalidChars";

/** Which rule `name` breaks, or `null` if it breaks none. */
export function usernameProblem(name: string): UsernameProblem | null {
  if (name.length < USERNAME_MIN) return "tooShort";
  if (name.length > USERNAME_MAX) return "tooLong";
  if (!USERNAME_PATTERN.test(name)) return "invalidChars";
  return null;
}
