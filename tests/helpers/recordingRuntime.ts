import { mock } from "node:test";
import type { SocketServer } from "../../server/socket/socketTypes.ts";
import { installTableHandlers } from "../../server/game/tableHandlers.ts";
import { activeGameStore } from "../../server/store/activeGameStore.ts";

export type Address = { room: string } | { user: string };
export type JournalEntry =
  | { kind: "send"; to: Address; event: string; args: unknown[] }
  | { kind: "write"; name: string; args: unknown[] }
  | { kind: "store"; name: string; args: unknown[] };

export function recordingRuntime() {
  const journal: JournalEntry[] = [];
  const address = (name: string): Address =>
    name.startsWith("user:") ? { user: name.slice("user:".length) } : { room: name };
  const target = (name: string) => ({
    emit: (event: string, ...args: unknown[]) => {
      const ack = typeof args.at(-1) === "function" ? (args.pop() as (err: unknown) => void) : null;
      journal.push({ kind: "send", to: address(name), event, args });
      ack?.(null);
    },
  });
  const rt = {
    to: (name: string) => ({ ...target(name), timeout: () => target(name) }),
    in: () => ({ fetchSockets: async () => [] }),
    fetchSockets: async () => [],
    on: () => {},
    serverSideEmit: (...args: unknown[]) => (args.at(-1) as (err: unknown, r: unknown[]) => void)(null, []),
    sockets: { adapter: { rooms: new Map() }, sockets: new Map() },
  } as unknown as SocketServer;
  installTableHandlers(rt);
  mock.method(activeGameStore, "write", async (...args: unknown[]) => {
    journal.push({ kind: "write", name: "persistGameState", args });
  });
  mock.method(activeGameStore, "remove", async (...args: unknown[]) => {
    journal.push({ kind: "store", name: "remove", args });
  });
  return {
    rt,
    journal,
    get sent() {
      return journal.filter((e) => e.kind === "send");
    },
  };
}
