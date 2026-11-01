// tests/integration/socketTicketLimiter.test.ts — the socket-ticket budget is
// each account's own. Every client of a household, a school or a carrier NAT
// shares one IP, and a budget keyed on it refused all but the first sixty.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { register } from "../helpers/client.ts";

describe("POST /api/auth/socket-ticket is limited per account", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  before(async () => {
    delete process.env.MURLAN_TICKET_RATE_LIMIT;
    server = await startTestServer();
  });
  after(async () => { if (server) await server.stop(); });

  const mint = (cookie: string) =>
    fetch(`${server.url}/api/auth/socket-ticket`, { method: "POST", headers: { cookie } }).then(async (res) => {
      await res.arrayBuffer();
      return res.status;
    });

  test("two accounts behind one IP each get sixty a minute, and the sixty-first is refused", async () => {
    const { cookie: ana } = await register(server, "ticket_ana");
    const { cookie: bes } = await register(server, "ticket_bes");

    const anas: number[] = [];
    for (let i = 0; i < 61; i++) anas.push(await mint(ana));
    assert.deepEqual(anas.slice(0, 60), Array(60).fill(200));
    assert.equal(anas[60], 429, "the sixty-first ticket in a minute was minted");

    assert.equal(await mint(bes), 200, "bes was refused on ana's budget: the key is the IP, not the account");
  });
});
