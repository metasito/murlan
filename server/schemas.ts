import { z } from "zod";
import { SUPPORTED_LOCALES, type Locale } from "../shared/i18n.ts";
import { BUG_REPORT_LIMITS } from "./bugReports.ts";

export const RegisterSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/, { message: "Letters, numbers and underscores only" }),
  password: z.string().min(6).max(100),
});

/**
 * A rename is registration's username rule and nothing else — referenced rather than restated,
 * so the two cannot drift into accepting different names.
 */
export const RenameSchema = z.object({ username: RegisterSchema.shape.username });

export const LoginSchema = z.object({
  username: z.string().min(1).max(30),
  password: z.string().min(1).max(100),
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
