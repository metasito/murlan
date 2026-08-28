// What makes a username acceptable, read by the server's zod schema and by the
// screens that have to tell a player which rule they broke.
//
// It lives here, with no imports, because both sides need it: `server/schemas.ts`
// builds `RegisterSchema` from it, and the client bundle reaches `shared/` the
// same way `lib/i18n.ts` reaches `shared/i18n.ts`. Anything imported here is
// imported into the app, so keep it free of zod and drizzle.
//
// The server answers a bad name with one code, `INVALID_PAYLOAD`, for every
// rule at once. `usernameProblem` is how a screen says "too short" rather than
// "invalid" without holding a second copy of the rule to decide it.

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
