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
  friendCode: z
    .string()
    .length(6)
    .toUpperCase()
    .regex(/^[A-Z0-9]{6}$/),
});

export const ExchangeCardSchema = z.object({
  cardIndex: z.number().int().min(0).max(52),
});
