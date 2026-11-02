// tests/server/authRoutesLimited.test.ts — #892: rate limiting is a per-route
// decision with no enforced default. Two `/api/auth/*` routes shipped with
// none at all (verify-email, change-password) and were only found by a
// review agent reading every mounting by hand. This is that reading, done
// once and pinned: every `/api/auth/*` route, and every route naming any
// limiter, names exactly the limiters written in tests/helpers/routeLimiters.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { allRouteCalls } from "../helpers/routeSources.ts";
import { LIMITERS } from "../helpers/routeLimiters.ts";

test("every auth route and every limited route names exactly its written limiters", () => {
  const isLimiter = (name: string) => /Limiter$/.test(name);
  const found = Object.fromEntries(
    allRouteCalls()
      .filter((m) => m.route.includes(" /api/auth/") || m.middleware.some(isLimiter))
      .map((m) => [m.route, m.middleware.filter(isLimiter)])
  );
  assert.deepEqual(
    found,
    LIMITERS,
    "a route's limiters changed — update LIMITERS deliberately rather than widening the check"
  );
});
