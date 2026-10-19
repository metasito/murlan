import { e2eFast } from "../e2eConfig.ts";

/** How long an offline bot "thinks" before playing; nothing in a build the E2E harness made. */
export const OFFLINE_BOT_DELAY_MS = e2eFast() ? 0 : 1100;
