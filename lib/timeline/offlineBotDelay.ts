import { E2E_FAST } from "../e2eConfig.ts";

/** How long an offline bot "thinks" before playing; nothing in a build the E2E harness made. */
export const OFFLINE_BOT_DELAY_MS = E2E_FAST ? 0 : 1100;
