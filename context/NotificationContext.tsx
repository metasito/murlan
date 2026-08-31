import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  ReactNode,
} from "react";

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

interface NotificationContextValue {
  notification: NotificationData | null;
  showNotification: (n: NotificationData) => void;
  dismissNotification: () => void;
  /**
   * The window y a visible banner reaches down to, and 0 when none is up.
   *
   * A banner floats over the navigator, so nothing below it knows it is there.
   * Published rather than derived because the height is the message's: two
   * lines of text and a title is not the same banner as one line, and a
   * screen that guessed would either overlap or reserve a strip of nothing.
   */
  bannerBottom: number;
  reportBannerBottom: (bottom: number) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function useNotification() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotification must be used within NotificationProvider");
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
  return useContext(NotificationContext)?.bannerBottom ?? 0;
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<NotificationData[]>([]);

  const showNotification = useCallback((n: NotificationData) => {
    setQueue((prev) => [...prev, n]);
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

  const contextValue = useMemo(
    () => ({
      notification,
      showNotification,
      dismissNotification,
      bannerBottom: notification ? bannerBottom : 0,
      reportBannerBottom,
    }),
    [notification, showNotification, dismissNotification, bannerBottom, reportBannerBottom]
  );

  return (
    <NotificationContext.Provider value={contextValue}>
      {children}
    </NotificationContext.Provider>
  );
}
