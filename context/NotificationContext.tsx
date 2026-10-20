import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  ReactNode,
} from "react";
import { t, translateServerPayload, type ServerPayload } from "@/lib/i18n";
import { Reading } from "@/lib/theme";

export type NotificationType =
  | "friend_request"
  | "friend_accepted"
  | "game_invite"
  | "game_info"
  | "game_error"
  | "afk"
  | "connection";

export interface NotificationData {
  type: NotificationType;
  title: string;
  message: string;
  onPress?: () => void;
  /** How long it stays readable. Defaults to `Reading.notice`. */
  duration?: number;
}

export interface NotificationCommands {
  showNotification: (n: NotificationData) => void;
  /** A `game_error` banner titled `common.error` unless `opts.title` says otherwise. */
  notifyError: (message: string, opts?: { title?: string; duration?: number }) => void;
  /** A server refusal in the player's language, as a `game_error` banner. */
  notifyServerError: (payload: ServerPayload) => void;
}

interface BannerValue {
  notification: NotificationData | null;
  dismissNotification: () => void;
  /**
   * The window y a visible banner reaches down to, and 0 when none is up.
   *
   * Measured rather than derived: the height is the message's, and a title
   * with two lines under it is not the same banner as one line.
   */
  bannerBottom: number;
  reportBannerBottom: (bottom: number) => void;
}

export const NOTIFICATION_QUEUE_MAX = 3;

export function createNotifyCommands(
  showNotification: (n: NotificationData) => void
): NotificationCommands {
  const notifyError: NotificationCommands["notifyError"] = (message, opts) =>
    showNotification({
      type: "game_error",
      title: opts?.title ?? t("common.error"),
      message,
      duration: opts?.duration,
    });
  return {
    showNotification,
    notifyError,
    notifyServerError: (payload) =>
      notifyError(translateServerPayload(payload), { duration: Reading.notice }),
  };
}

const CommandsContext = createContext<NotificationCommands | null>(null);
const BannerContext = createContext<BannerValue | null>(null);

/** Stable for the provider's life: a banner change never re-renders its consumers. */
export function useNotification(): NotificationCommands {
  const ctx = useContext(CommandsContext);
  if (!ctx) throw new Error("useNotification must be used within NotificationProvider");
  return ctx;
}

export function useBanner(): BannerValue {
  const ctx = useContext(BannerContext);
  if (!ctx) throw new Error("useBanner must be used within NotificationProvider");
  return ctx;
}

/**
 * How far down a visible banner reaches, for a layout that has to make room.
 *
 * Answers 0 rather than throwing when there is no provider: the banner lives
 * inside the provider too, so no provider means no banner, and a shared layout
 * must not be the reason a screen cannot be rendered on its own — the capture
 * harness and every component test do exactly that.
 */
export function useBannerBottom(): number {
  return useContext(BannerContext)?.bannerBottom ?? 0;
}

export function NotificationProvider({
  accountId,
  children,
}: {
  /** The signed-in account: a queued banner and its `onPress` belong to it alone. */
  accountId?: string;
  children: ReactNode;
}) {
  const [queue, setQueue] = useState<NotificationData[]>([]);

  const [shownAccountId, setShownAccountId] = useState(accountId);
  if (accountId !== shownAccountId) {
    setShownAccountId(accountId);
    setQueue([]);
  }

  const showNotification = useCallback((n: NotificationData) => {
    setQueue((prev) => {
      const same = (q: NotificationData) =>
        q.type === n.type && q.title === n.title && q.message === n.message;
      if (prev.some(same)) return prev;
      const next = [...prev, n];
      // The banner on screen stays; the stalest of those waiting behind it go.
      return next.length > NOTIFICATION_QUEUE_MAX
        ? [...next.slice(0, 1), ...next.slice(next.length - NOTIFICATION_QUEUE_MAX + 1)]
        : next;
    });
  }, []);

  const notification = queue[0] ?? null;

  // Keyed on the notification being dismissed, so the two banners that show the
  // same one (root and inside a Modal) drop it once between them.
  const dismissNotification = useCallback(() => {
    setQueue((prev) => (prev[0] === notification ? prev.slice(1) : prev));
  }, [notification]);

  const [bannerBottom, setBannerBottom] = useState(0);
  // Ignores a repeat of the same value: the banner measures on every layout
  // pass, and re-rendering every screen because it measured the same height
  // again is a re-render per frame of its own slide-in.
  const reportBannerBottom = useCallback((bottom: number) => {
    setBannerBottom((prev) => (Math.abs(prev - bottom) < 1 ? prev : bottom));
  }, []);

  const commands = useMemo(() => createNotifyCommands(showNotification), [showNotification]);

  const banner = useMemo(
    () => ({
      notification,
      dismissNotification,
      bannerBottom: notification ? bannerBottom : 0,
      reportBannerBottom,
    }),
    [notification, dismissNotification, bannerBottom, reportBannerBottom]
  );

  return (
    <CommandsContext.Provider value={commands}>
      <BannerContext.Provider value={banner}>{children}</BannerContext.Provider>
    </CommandsContext.Provider>
  );
}
