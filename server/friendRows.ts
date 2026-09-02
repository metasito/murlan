// The one place a friend row is shaped for the wire.
//
// The GET serves these and the socket pushes them, and a client that seats a
// pushed row beside fetched ones needs the two to be indistinguishable — a
// second copy of the field list is a list that will flicker between two
// versions of one request the first time either side changes.
import type { Friend, User } from "../shared/schema.ts";
import type { FriendInfo, FriendRequestInfo } from "../lib/wire.ts";

export function friendRow(friend: User): FriendInfo {
  return {
    id: friend.id,
    username: friend.username,
    lastSeen: friend.lastSeen ? friend.lastSeen.toISOString() : null,
  };
}

/**
 * The row is the request's own; the user is whoever is at the far end of it —
 * the requester on `/api/friends/requests`, the recipient on `/api/friends/sent`.
 */
export function friendRequestRow(
  request: Pick<Friend, "id" | "createdAt">,
  other: User
): FriendRequestInfo {
  return {
    id: request.id,
    username: other.username,
    createdAt: request.createdAt ? request.createdAt.toISOString() : null,
  };
}
