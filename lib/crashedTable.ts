import type { Socket } from "@/lib/socket";
import { sendIntent } from "@/lib/sendIntent";
import { forgetTableHandles } from "@/lib/tableHandles";

/** Which table the crashed screen was showing. */
export type CrashScope = "online" | "offline";

/**
 * Walks away from the table a crash happened on, before Continue or Restart.
 *
 * Online, the seat is released as well as forgotten: the socket outlives the
 * crash, so the server sees no disconnect, its next `game:state` routes straight
 * back into the crash, and no bot ever takes the seat over. Both intents are sent
 * because the screen that knew which one applies is the one that crashed; each is
 * a no-op on the server for a socket it does not describe. Offline, nothing online
 * is the crash's, so the online resume handles stay.
 */
export async function leaveCrashedTable(scope: CrashScope, socket: Socket | null): Promise<void> {
  if (scope === "offline") return;
  await Promise.all([
    sendIntent(socket, "room:leave", undefined, { attempts: 1 }),
    sendIntent(socket, "room:unspectate", undefined, { attempts: 1 }),
    forgetTableHandles(),
  ]);
}
