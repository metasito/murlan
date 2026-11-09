/**
 * Callees `shutdown()` may await with only a budget handed in, because each ends by it. `within` is the
 * general form and is checked apart. `tests/server/boundedShutdownSteps.test.ts` holds one proof per name.
 */
export const SELF_BOUNDED: Record<string, string> = {
  settleInFlight: "gives up at its argument",
  closeTableOwners: "settles for at most its argument, then destroys the client",
  closeDatabase: "drains for at most `drainMs`",
};
