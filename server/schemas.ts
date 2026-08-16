import { z } from "zod";

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

export const ExchangeCardSchema = z.object({
  cardIndex: z.number().int().min(0).max(52),
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
  platform: z.enum(["ios", "android", "web"]).optional(),
  appVersion: z.string().max(40).optional(),
});
