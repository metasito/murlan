import type { Express, Response } from "express";
import { AddFriendSchema, RoomCodeParam, UserSearchQuery } from "../../../shared/httpSchemas.ts";
import { routeLimiter } from "../rateLimit.ts";
import { onSignedIn } from "../mount.ts";
import { readParam, validate, validateQuery } from "../validate.ts";
import { friendStore } from "../../store/friendStore.ts";
import { friendRequestRow, friendRow } from "../../store/friendRows.ts";
import { userStore } from "../../store/userStore.ts";
import { friendships, type FriendRequestRefusal } from "../../socket/friendships.ts";
import { payload } from "../../shared/payload.ts";

const FRIEND_REQUEST_REFUSAL_STATUS = {
  USER_NOT_FOUND: 404,
  CANNOT_ADD_SELF: 400,
  ALREADY_FRIENDS: 409,
  FRIEND_REQUEST_ALREADY_SENT: 409,
  FRIEND_REQUEST_INCOMING_PENDING: 409,
} as const satisfies Record<FriendRequestRefusal, number>;

/** Spelled out because tests/tooling/refusalCodesTested.test.ts reads a refusal's code only as a literal. */
const FRIEND_REQUEST_REFUSAL_CODE = {
  USER_NOT_FOUND: "USER_NOT_FOUND",
  CANNOT_ADD_SELF: "CANNOT_ADD_SELF",
  ALREADY_FRIENDS: "ALREADY_FRIENDS",
  FRIEND_REQUEST_ALREADY_SENT: "FRIEND_REQUEST_ALREADY_SENT",
  FRIEND_REQUEST_INCOMING_PENDING: "FRIEND_REQUEST_INCOMING_PENDING",
} as const satisfies { [C in FriendRequestRefusal]: C };

const friendLimiter = routeLimiter({
  windowMs: 60 * 1000,
  defaultMax: 10,
  message: payload("RATE_LIMITED"),
});

function sendFriendshipResult(res: Response, result: { ok: true } | { ok: false; code: "FRIEND_REQUEST_NOT_FOUND" }) {
  if (result.ok) res.json(result);
  else res.status(404).json({ ...payload("FRIEND_REQUEST_NOT_FOUND") });
}

export function mountFriends(app: Express): void {
  onSignedIn(app, "GET /api/friends", async (_req, res, userId) => {
    const friends = await friendStore.getFriends(userId);
    res.json(friends.map((f) => friendRow(f.friend)));
  });

  onSignedIn(app, "GET /api/friends/requests", async (_req, res, userId) => {
    const requests = await friendStore.getPendingFriendRequests(userId);
    res.json(requests.map((r) => friendRequestRow(r, r.requester)));
  });

  // The invites a socket would have announced. This is the half that survives
  // the recipient being away — the emit and the push are both "look now".
  onSignedIn(app, "GET /api/friends/invites", async (_req, res, userId) => {
    res.json(await friendStore.getGameInvites(userId));
  });

  onSignedIn(app, "DELETE /api/friends/invites/:roomCode", async (req, res, userId) => {
    const roomCode = RoomCodeParam.safeParse(String(req.params.roomCode ?? "").toUpperCase());
    if (!roomCode.success) {
      res.status(400).json({ ...payload("INVALID_ROOM_CODE") });
      return;
    }
    res.json(await friendships.decline(userId, roomCode.data));
  });

  onSignedIn(app, "GET /api/users/search", validateQuery(UserSearchQuery, "INVALID_USERNAME"), async (req, res, userId) => {
    const found = await userStore.getUserByUsername(req.query.username);
    if (!found || found.id === userId) {
      res.status(404).json({ ...payload("USER_NOT_FOUND") });
      return;
    }
    res.json({ id: found.id, username: found.username });
  });

  onSignedIn(app, "GET /api/friends/sent", async (_req, res, userId) => {
    const sent = await friendStore.getSentFriendRequests(userId);
    res.json(sent.map((r) => friendRequestRow(r, r.recipient)));
  });

  onSignedIn(app, "POST /api/friends/add", friendLimiter, validate(AddFriendSchema), async (req, res, userId) => {
    const { username } = req.body;

    const result = await friendships.request(userId, username);
    if (!result.ok) {
      res.status(FRIEND_REQUEST_REFUSAL_STATUS[result.code]).json({ ...payload(FRIEND_REQUEST_REFUSAL_CODE[result.code]) });
      return;
    }
    res.json(result);
  });

  onSignedIn(app, "DELETE /api/friends/requests/:id", async (req, res, userId) => {
    const id = readParam(res, req.params.id);
    if (id === null) return;
    sendFriendshipResult(res, await friendships.cancelRequest(id, userId));
  });

  onSignedIn(app, "POST /api/friends/accept/:id", async (req, res, userId) => {
    const id = readParam(res, req.params.id);
    if (id === null) return;
    sendFriendshipResult(res, await friendships.accept(id, userId));
  });

  onSignedIn(app, "POST /api/friends/decline/:id", async (req, res, userId) => {
    const id = readParam(res, req.params.id);
    if (id === null) return;
    sendFriendshipResult(res, await friendships.declineRequest(id, userId));
  });

  onSignedIn(app, "DELETE /api/friends/:friendUserId", async (req, res, userId) => {
    const friendUserId = readParam(res, req.params.friendUserId);
    if (friendUserId === null) return;
    res.json(await friendships.remove(userId, friendUserId));
  });
}
