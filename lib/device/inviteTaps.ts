import * as Notifications from "expo-notifications";
import { router, type Href } from "expo-router";
import { joinRouteFor } from "../deepLink";

/** The launch tap's identifier outlives a remount of whoever subscribed. */
let followedTap: string | null = null;

function follow(response: Notifications.NotificationResponse) {
  const { identifier, content } = response.notification.request;
  if (identifier === followedTap) return;
  followedTap = identifier;
  const data = content.data as { code?: unknown; roomCode?: unknown } | null;
  const route = data?.code === "FRIEND_INVITE" ? joinRouteFor(data.roomCode) : null;
  if (route) router.push(route as Href);
}

/**
 * Expo Router hands a scheme or universal link to `redirectSystemPath`, never
 * a notification tap: this sends a tapped friend invite (server/socket/socketPresence.ts)
 * to the `/join/<CODE>` route a join link resolves to.
 */
export function followInviteTaps(): () => void {
  const launch = Notifications.getLastNotificationResponse();
  if (launch) {
    Notifications.clearLastNotificationResponse();
    follow(launch);
  }
  const subscription = Notifications.addNotificationResponseReceivedListener(follow);
  return () => subscription.remove();
}
