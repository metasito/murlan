// tests/pushShape.test.ts — what is sent to Expo, and what is believed back.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEVICE_NOT_REGISTERED,
  buildPushRequest,
  deadTokens,
} from "../server/pushShape.ts";

const TOKENS = ["ExponentPushToken[a]", "ExponentPushToken[b]"];

test("one message per device, in the order the tokens were given", () => {
  const reqs = buildPushRequest(TOKENS, {
    title: "Murlan",
    body: "Ana ti ha invitato a giocare.",
    data: { roomCode: "ABC123" },
  });

  assert.equal(reqs.length, 2);
  assert.deepEqual(reqs.map((r) => r.to), TOKENS);
  for (const r of reqs) {
    assert.equal(r.title, "Murlan");
    assert.equal(r.body, "Ana ti ha invitato a giocare.");
    assert.equal(r.sound, "default");
    // The room code is the whole point of the notification: tapping it has to
    // be able to take the player to the table that was waiting for them.
    assert.equal(r.data?.roomCode, "ABC123");
  }
});

test("a message with no payload still sends", () => {
  const [req] = buildPushRequest(["ExponentPushToken[a]"], { title: "T", body: "B" });
  assert.equal(req.data, undefined);
  assert.equal(req.to, "ExponentPushToken[a]");
});

test("only the tokens Expo calls gone are dropped", () => {
  const tickets = [
    { status: "ok" },
    { status: "error", details: { error: DEVICE_NOT_REGISTERED } },
  ];
  assert.deepEqual(deadTokens(TOKENS, tickets), ["ExponentPushToken[b]"]);
});

test("another kind of error is not a dead device", () => {
  const tickets = [
    { status: "error", details: { error: "MessageRateExceeded" } },
    { status: "ok" },
  ];
  assert.deepEqual(deadTokens(TOKENS, tickets), []);
});

// Tickets are paired with tokens by position and nothing else, so a response
// that is not the length that was sent cannot be trusted to say which device
// is which. Deleting a live registration because a response was truncated is
// far worse than keeping a dead one until the next send.
test("a response that does not line up deletes nothing", () => {
  assert.deepEqual(deadTokens(TOKENS, undefined), []);
  assert.deepEqual(deadTokens(TOKENS, []), []);
  assert.deepEqual(
    deadTokens(TOKENS, [{ status: "error", details: { error: DEVICE_NOT_REGISTERED } }]),
    [],
    "one ticket for two tokens says nothing about which one is gone"
  );
  assert.deepEqual(deadTokens(TOKENS, "nonsense" as never), []);
});

test("nothing sent means nothing to drop", () => {
  assert.deepEqual(buildPushRequest([], { title: "T", body: "B" }), []);
  assert.deepEqual(deadTokens([], []), []);
});
