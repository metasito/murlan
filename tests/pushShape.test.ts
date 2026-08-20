// tests/pushShape.test.ts — what is sent to Expo, and what is believed back.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEVICE_NOT_REGISTERED,
  buildPushRequest,
  deadTokens,
  renderBody,
} from "../server/pushShape.ts";
import { translate } from "../shared/i18n.ts";

const TOKENS = ["ExponentPushToken[a]", "ExponentPushToken[b]"];
const DEVICES = TOKENS.map((token) => ({ token, locale: "en" }));
const INVITE = { title: "Murlan", code: "FRIEND_INVITE", params: { username: "Ana" } };

test("one message per device, in the order the tokens were given", () => {
  const reqs = buildPushRequest(DEVICES, { ...INVITE, data: { roomCode: "ABC123" } });

  assert.equal(reqs.length, 2);
  assert.deepEqual(reqs.map((r) => r.to), TOKENS);
  for (const r of reqs) {
    assert.equal(r.title, "Murlan");
    assert.equal(r.body, translate("en", "server.FRIEND_INVITE", { username: "Ana" }));
    assert.equal(r.sound, "default");
    // The room code is the whole point of the notification: tapping it has to
    // be able to take the player to the table that was waiting for them.
    assert.equal(r.data?.roomCode, "ABC123");
    assert.equal(r.data?.code, "FRIEND_INVITE");
  }
});

test("each device is written in the language that device reads", () => {
  const reqs = buildPushRequest(
    [
      { token: "ExponentPushToken[a]", locale: "it" },
      { token: "ExponentPushToken[b]", locale: "sq" },
      { token: "ExponentPushToken[c]", locale: "en" },
    ],
    INVITE
  );
  const bodies = reqs.map((r) => r.body);

  assert.deepEqual(bodies, [
    translate("it", "server.FRIEND_INVITE", { username: "Ana" }),
    translate("sq", "server.FRIEND_INVITE", { username: "Ana" }),
    translate("en", "server.FRIEND_INVITE", { username: "Ana" }),
  ]);
  // The floor: three locales that render to the same string would pass the
  // assertion above while the recipient's language was still never consulted.
  assert.equal(new Set(bodies).size, 3);
});

test("a locale the server does not know falls back to English rather than a key", () => {
  const english = renderBody(INVITE, "en");
  assert.equal(renderBody(INVITE, "de"), english);
  assert.equal(renderBody(INVITE, ""), english);
  assert.ok(english.includes("Ana"));
  assert.ok(!english.includes("server."));
});

test("a message with no payload still carries its code", () => {
  const [req] = buildPushRequest([{ token: "ExponentPushToken[a]", locale: "en" }], INVITE);
  assert.deepEqual(req.data, { code: "FRIEND_INVITE" });
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
  assert.deepEqual(buildPushRequest([], INVITE), []);
  assert.deepEqual(deadTokens([], []), []);
});
