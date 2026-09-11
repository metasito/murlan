import { eq, and, sql, isNull, isNotNull } from "drizzle-orm";
import { db } from "./db.ts";
import { users } from "../shared/schema.ts";
import type { User, InsertUser } from "../shared/schema.ts";
import { randomCode } from "./codes.ts";

/** The constraint a 23505 names, or undefined if the error is something else. */
export function uniqueViolation(err: unknown): string | undefined {
  for (let e = err; e; e = (e as { cause?: unknown }).cause) {
    const { code, constraint } = e as { code?: string; constraint?: string };
    if (code === "23505" && constraint) return constraint;
  }
  return undefined;
}

/** The pre-check at POST /api/auth/register cannot see a concurrent insert. */
export class UsernameTakenError extends Error {
  constructor() {
    super("Username already taken");
  }
}

/** Same shape as UsernameTakenError, for the email's own unique index. */
export class EmailTakenError extends Error {
  constructor() {
    super("Email already registered");
  }
}

export const userStore = {
  async getUser(id: string) {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  },

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.username}) = lower(${username})`);
    return user;
  },

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`);
    return user;
  },

  /**
   * request-password-reset's lookup. `users_email_lower_uq` used to make
   * `getUserByEmail` safe here; #897 replaced it with a *partial* unique
   * index (verified rows only), so any number of unverified accounts may
   * now share an address and `getUserByEmail`'s bare `[0]` returns whichever
   * one the planner happens to hand back — silently answering for the wrong
   * account (#900 review, finding 1). Scoping to `emailVerifiedAt IS NOT
   * NULL` is exactly the predicate the partial index enforces uniqueness
   * over, so this can never return more than the one account that owns the
   * address.
   */
  async getVerifiedUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(and(sql`lower(${users.email}) = lower(${email})`, isNotNull(users.emailVerifiedAt)));
    return user;
  },

  /**
   * Unlike `getUserByEmail`, may legitimately return more than one id: the
   * partial unique index only covers verified rows, so several unverified
   * accounts can share an address (see `getVerifiedUserByEmail`'s doc).
   */
  async getUserIdsByEmail(email: string): Promise<string[]> {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`);
    return rows.map((row) => row.id);
  },

  async createUser(insertUser: InsertUser): Promise<User> {
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const friendCode = randomCode(6);
        const [user] = await db
          .insert(users)
          .values({ ...insertUser, friendCode })
          .returning();
        if (!user) throw new Error("createUser: insert returned no row");
        return user;
      } catch (err) {
        // drizzle-orm wraps the driver error in a DrizzleQueryError, so the
        // constraint name is on the cause, not on what was thrown.
        const violated = uniqueViolation(err);
        if (violated?.includes("friend_code") && attempt < 9) continue;
        if (violated?.includes("username")) throw new UsernameTakenError();
        if (violated?.includes("email")) throw new EmailTakenError();
        throw err;
      }
    }
    throw new Error("Failed to generate unique friend code");
  },

  /**
   * Set by the token redemption that proved control of the mailbox.
   * "lost_race" is a different account already having verified this address
   * first — `users_email_verified_lower_uq` (#897) is the actual arbiter of
   * that, so this account's own claim is cleared rather than left collided
   * with it. "not_found" is anything that leaves no row to update: the
   * account no longer exists, or its own email claim is already gone (a
   * prior race, or a second outstanding token — #894 review, finding 3 —
   * redeemed after the first already cleared it). Scoping the UPDATE to
   * `email IS NOT NULL` is what makes that second case return "not_found"
   * instead of silently re-verifying a claim that no longer exists.
   */
  async markEmailVerified(userId: string): Promise<"verified" | "lost_race" | "not_found"> {
    try {
      const [row] = await db
        .update(users)
        .set({ emailVerifiedAt: new Date() })
        .where(and(eq(users.id, userId), isNotNull(users.email)))
        .returning({ id: users.id });
      return row ? "verified" : "not_found";
    } catch (err) {
      if (!uniqueViolation(err)?.includes("email")) throw err;
      await db.update(users).set({ email: null }).where(eq(users.id, userId));
      return "lost_race";
    }
  },

  /**
   * #863: an existing account (predating the email requirement) adding one.
   * Same `EmailTakenError` shape `createUser` raises on its own unique index —
   * the caller's route re-checks `email IS NULL` first, but that check and
   * this write are not one transaction, so the constraint is still the
   * authority.
   */
  async setEmail(userId: string, email: string): Promise<User> {
    try {
      const [user] = await db.update(users).set({ email }).where(eq(users.id, userId)).returning();
      if (!user) throw new Error("setEmail: no such user");
      return user;
    } catch (err) {
      if (uniqueViolation(err)?.includes("email")) throw new EmailTakenError();
      throw err;
    }
  },

  /**
   * Throws `UsernameTakenError` when the name is another account's. Both unique constraints can
   * raise it — the column's own, and `users_username_lower_uq` on `lower(username)` — so a caller
   * that checked first still has to catch: the check and the write are not one transaction.
   */
  async renameUser(userId: string, username: string): Promise<User> {
    try {
      const [user] = await db
        .update(users)
        .set({ username })
        .where(eq(users.id, userId))
        .returning();
      if (!user) throw new Error("renameUser: no such user");
      return user;
    } catch (err) {
      if (uniqueViolation(err)?.includes("username")) throw new UsernameTakenError();
      throw err;
    }
  },

  /**
   * `deleteAccount.ts`'s own `DELETE FROM session WHERE sess->>'userId'`
   * idiom, narrowed by `sid != keepSid` so the session the request itself
   * arrived on survives the clear.
   */
  async changePassword(userId: string, passwordHash: string, keepSid: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.update(users).set({ password: passwordHash }).where(eq(users.id, userId));
      await tx.execute(
        sql`DELETE FROM session WHERE sess->>'userId' = ${userId} AND sid != ${keepSid}`
      );
    });
  },

  /**
   * Box 6: unlike `changePassword`, a reset is never made from within a live
   * session, so there is no `keepSid` to spare — every session for the
   * account is cleared.
   */
  async resetPassword(userId: string, passwordHash: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.update(users).set({ password: passwordHash }).where(eq(users.id, userId));
      await tx.execute(sql`DELETE FROM session WHERE sess->>'userId' = ${userId}`);
    });
  },

  async updateLastSeen(userId: string): Promise<void> {
    await db.update(users).set({ lastSeen: new Date() }).where(eq(users.id, userId));
  },

  /** First time only: the answer is "has it ever been offered", so the first date is the true one. */
  async markTutorialSeen(userId: string): Promise<void> {
    await db
      .update(users)
      .set({ tutorialSeenAt: new Date() })
      .where(and(eq(users.id, userId), isNull(users.tutorialSeenAt)));
  },
};
