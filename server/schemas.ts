import { z } from "zod";
import { SUPPORTED_LOCALES, type Locale } from "../shared/i18n.ts";

export const RegisterSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/, { message: "Solo lettere, numeri e underscore" }),
  password: z.string().min(6).max(100),
});

export const LoginSchema = z.object({
  username: z.string().min(1).max(30),
  password: z.string().min(1).max(100),
});

export const AddFriendSchema = z.object({
  username: z.string().min(1, "Username richiesto"),
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
 * A device registering for notifications.
 *
 * Expo's tokens are `ExponentPushToken[…]` or `ExpoPushToken[…]`; the shape is
 * checked here so a malformed one never reaches the push service, where it
 * would be one rejected ticket among the real ones.
 */
export const PushTokenSchema = z.object({
  token: z.string().min(1).max(200).regex(/^Expo(nent)?PushToken\[[^\]]+\]$/, {
    message: "Token push non valido",
  }),
  platform: z.enum(["ios", "android"]),
  // Optional: the DELETE sends no locale, and neither does a client older than
  // this field. Absent means English (server/routes.ts).
  locale: z.enum(SUPPORTED_LOCALES as [Locale, ...Locale[]]).optional(),
});
