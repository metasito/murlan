/**
 * #863: the non-blocking add-email nudge shown to an account that predates
 * the email requirement — `email IS NULL` (docs/superpowers/specs/2026-09-
 * 03-account-recovery-design.md, Box 1). A pure predicate so app/profile.tsx's
 * card visibility is testable with `node --test`, without rendering React.
 */
export function shouldShowAddEmailCard(user: { email?: string | null }): boolean {
  // Absent, not just null: AuthContext hydrates from an AsyncStorage entry that
  // may predate the field, and an upgraded install is exactly this cohort.
  return !user.email;
}

/**
 * #893: the state a player returns to the app in, having read the
 * verification mail on another device — an address is on the row, but
 * nothing has redeemed its token yet.
 */
export function shouldShowVerifyEmailCard(user: { email?: string | null; emailVerified?: boolean }): boolean {
  return Boolean(user.email) && !user.emailVerified;
}
