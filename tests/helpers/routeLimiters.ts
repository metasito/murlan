// The limiters every limited route names, written out once: tests/server/authRoutesLimited.test.ts
// holds the routes to it, and tests/server/rateLimiterFactory.test.ts the limiters its scan finds.
export const LIMITERS: Record<string, string[]> = {
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
  "PATCH /api/users/me": ["renameLimiter"],
  "POST /api/friends/add": ["friendLimiter"],
  "POST /api/client-errors": ["errorReportLimiter"],
  "POST /api/bug-reports": ["bugReportLimiter"],
};
