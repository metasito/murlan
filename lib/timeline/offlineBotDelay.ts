/** How long an offline bot "thinks" before playing; nothing in a build the E2E harness made. */
export const OFFLINE_BOT_DELAY_MS = process.env.EXPO_PUBLIC_E2E_FAST === "1" ? 0 : 1100;
