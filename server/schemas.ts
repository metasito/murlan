import { z } from "zod";
import { SUPPORTED_LOCALES, type Locale } from "../shared/i18n.ts";
import { USERNAME_MAX, USERNAME_MIN, USERNAME_PATTERN } from "../shared/username.ts";
import { BUG_REPORT_LIMITS } from "./bugReports.ts";

export const RegisterSchema = z.object({
  username: z
    .string()
    .min(USERNAME_MIN)
    .max(USERNAME_MAX)
    .regex(USERNAME_PATTERN, { message: "Letters, numbers and underscores only" }),
  password: z.string().min(6).max(100),
  // #34: required at signup. Bounded to RFC 5321's own limit, ahead of the
  // format check, so a pathological value is rejected on size before regex
  // backtracking ever sees it.
  email: z.string().trim().min(3).max(254).email(),
});

/** `token` is a `randomBytes(32)` base64url value — see server/authTokens.ts. */
export const VerifyEmailSchema = z.object({
  token: z.string().min(1).max(128),
});

export const RequestPasswordResetSchema = z.object({
  email: RegisterSchema.shape.email,
});

/** The existing-account migration nudge (#863) — same shape signup validates. */
export const AddEmailSchema = z.object({
  email: RegisterSchema.shape.email,
});

/** `token` is a `randomBytes(32)` base64url value — see server/authTokens.ts. */
export const ResetPasswordSchema = z.object({
  token: z.string().min(1).max(128),
  newPassword: RegisterSchema.shape.password,
});

/**
 * A rename is registration's username rule and nothing else — referenced rather than restated,
 * so the two cannot drift into accepting different names.
 */
export const RenameSchema = z.object({ username: RegisterSchema.shape.username });

// Bounded like a username but not validated like one: a login says whether the
// credentials match, never which half of them was malformed.
export const LoginSchema = z.object({
  username: z.string().min(1).max(USERNAME_MAX),
  password: z.string().min(1).max(100),
});

// currentPassword is bounded but not shape-validated, like LoginSchema's
// password above — a wrong current password is refused by bcrypt.compare,
// not by this schema. newPassword takes RegisterSchema's own rule.
export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(100),
  newPassword: RegisterSchema.shape.password,
});

export const AddFriendSchema = z.object({
  username: z.string().min(1, "Username is required"),
});

/**
 * A crash reported by the client's error boundary.
 *
 * Every field is bounded. A stack trace has no natural size limit, and this is
 * the one endpoint that accepts attacker-controlled text straight into the log
 * — an unbounded field here is a way to fill the disk, not a diagnostic.
 */
export const ClientErrorSchema = z.object({
  message: z.string().min(1).max(500),
  stack: z.string().max(4000).optional(),
  componentStack: z.string().max(4000).optional(),
  screen: z.string().max(120).optional(),
  platform: z.enum(["ios", "android", "web"]).optional(),
  appVersion: z.string().max(40).optional(),
});

/**
 * A player saying something is wrong, in their own words.
 *
 * Bounded here rather than by the field's own `maxLength`: a client is not the
 * thing to trust with the size of what it sends, and this is an authenticated
 * endpoint accepting arbitrary text. `BUG_REPORT_LIMITS` is the one place the
 * numbers live, so the route, the column and the test cannot disagree.
 */
export const BugReportSchema = z.object({
  description: z.string().trim().min(1).max(BUG_REPORT_LIMITS.description),
  screen: z.string().max(BUG_REPORT_LIMITS.screen).optional(),
  appVersion: z.string().max(BUG_REPORT_LIMITS.appVersion).optional(),
  platform: z.enum(["ios", "android", "web"]).optional(),
  locale: z.enum(SUPPORTED_LOCALES as [Locale, ...Locale[]]).optional(),
});

/**
 * A device registering for notifications.
 *
 * Expo's tokens are `ExponentPushToken[…]` or `ExpoPushToken[…]`; the shape is
 * checked here so a malformed one never reaches the push service, where it
 * would be one rejected ticket among the real ones.
 */
export const PushTokenSchema = z.object({
  token: z.string().min(1).max(200).regex(/^Expo(nent)?PushToken\[[^\]]+\]$/, {
    message: "Invalid push token",
  }),
  platform: z.enum(["ios", "android"]),
  // Optional: the DELETE sends no locale, and neither does a client older than
  // this field. Absent means English (server/routes.ts).
  locale: z.enum(SUPPORTED_LOCALES as [Locale, ...Locale[]]).optional(),
});
