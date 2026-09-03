/**
 * #863: the non-blocking add-email nudge shown to an account that predates
 * the email requirement — `email IS NULL` (docs/superpowers/specs/2026-09-
 * 03-account-recovery-design.md, Box 1). A pure predicate so app/profile.tsx's
 * card visibility is testable with `node --test`, without rendering React.
 */
export function shouldShowAddEmailCard(user: { email: string | null }): boolean {
  return user.email === null;
}
