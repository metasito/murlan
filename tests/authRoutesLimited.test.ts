// tests/authRoutesLimited.test.ts — #892: rate limiting is a per-route
// decision with no enforced default. Two `/api/auth/*` routes shipped with
// none at all (verify-email, change-password) and were only found by a
// review agent reading every mounting by hand. This is that reading, done
// once and pinned: every `/api/auth/*` route, and every route naming any
// limiter, names exactly the limiters written below.
import { test } from "node:test";
import assert from "node:assert/strict";
import { routeMountings } from "./helpers/routeMountings.ts";

const LIMITERS: Record<string, string[]> = {
  "POST /api/auth/register": ["authLimiter", "registerEmailLimiter"],
  "POST /api/auth/login": ["authLimiter", "loginUsernameLimiter"],
  // Destroys the session; there is nothing here to amplify or brute-force.
  "POST /api/auth/logout": [],
  // A read of the caller's own session — cheap, and answers 401 for anyone without one.
  "GET /api/auth/me": [],
  "POST /api/auth/change-password": ["changePasswordLimiter"],
  "POST /api/auth/add-email": ["addEmailLimiter"],
  "POST /api/auth/verify-email": ["authLimiter"],
  "POST /api/auth/resend-verification": ["resendVerificationLimiter"],
  "POST /api/auth/request-password-reset": ["authLimiter", "passwordResetRequestLimiter"],
  "POST /api/auth/reset-password": ["resetPasswordLimiter"],
  "POST /api/auth/socket-ticket": ["ticketLimiter"],
  "POST /api/push/token": ["pushLimiter"],
  "DELETE /api/push/token": ["pushLimiter"],
  "PATCH /api/users/me": ["renameLimiter"],
  "POST /api/friends/add": ["friendLimiter"],
  "POST /api/client-errors": ["errorReportLimiter"],
  "POST /api/bug-reports": ["errorReportLimiter"],
};

test("every auth route and every limited route names exactly its written limiters", () => {
  const isLimiter = (name: string) => /Limiter$/.test(name);
  const found = Object.fromEntries(
    routeMountings()
      .filter((m) => m.route.includes(" /api/auth/") || m.middleware.some(isLimiter))
      .map((m) => [m.route, m.middleware.filter(isLimiter)])
  );
  assert.deepEqual(
    found,
    LIMITERS,
    "a route's limiters changed — update LIMITERS deliberately rather than widening the check"
  );
});
