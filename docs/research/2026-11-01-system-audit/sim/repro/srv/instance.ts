// One server instance, as server/index.ts boots it, plus an IPC hook that runs the app's own
// shutdown(): on Windows child.kill("SIGTERM") is a hard TerminateProcess, so the graceful path is
// unreachable by signal (on Linux SIGTERM reaches it too). Reports step timestamps over IPC.
import { createApp } from "../../../../../../server/app.ts";
import { shutdown } from "../../../../../../server/http/shutdown.ts";
import { installProcessGuards } from "../../../../../../server/socket/socketSafety.ts";
import { checkBootEnv } from "../../../../../../server/http/bootEnv.ts";

const send = (msg: Record<string, unknown>) => process.send?.({ ...msg, t: Date.now() });

checkBootEnv();
const { server, io, rt } = await createApp();
const port = Number(process.env.PORT);
server.listen({ port, host: "127.0.0.1" }, () => send({ ev: "listening", port }));

process.on("message", (m) => {
  if (m !== "shutdown") return;
  send({ ev: "shutdown-start" });
  const tracedIo = {
    sockets: io.sockets,
    close: async () => {
      send({ ev: "io.close-start" });
      const r = await io.close();
      send({ ev: "io.close-done" });
      return r;
    },
  } as unknown as typeof io;
  const tracedTables = {
    handOffTables: async (budgetMs: number) => {
      send({ ev: "handOff-start" });
      const r = await rt.handOffTables(budgetMs);
      send({ ev: "handOff-done" });
      return r;
    },
    stopTables: async () => {
      send({ ev: "stopTables-start" });
      const r = await rt.stopTables();
      send({ ev: "stopTables-done" });
      return r;
    },
  } as unknown as typeof rt;
  void shutdown("SIGTERM", {
    io: tracedIo,
    server,
    tables: tracedTables,
    exit: (code) => {
      process.send?.({ ev: "exit", code, t: Date.now() }, () => process.exit(code));
      (setTimeout(() => process.exit(code), 200) as unknown as NodeJS.Timeout).unref();
    },
  });
});

installProcessGuards();
