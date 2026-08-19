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
  duration?: number; // ms, defaults to 4000
}

interface NotificationContextValue {
  notification: NotificationData | null;
  showNotification: (n: NotificationData) => void;
  dismissNotification: () => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function useNotification() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotification must be used within NotificationProvider");
  return ctx;
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

  const contextValue = useMemo(
    () => ({ notification, showNotification, dismissNotification }),
    [notification, showNotification, dismissNotification]
  );

  return (
    <NotificationContext.Provider value={contextValue}>
      {children}
    </NotificationContext.Provider>
  );
}
