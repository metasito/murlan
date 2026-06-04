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

const NotificationContext = createContext<NotificationContextValue>({
  notification: null,
  showNotification: () => {},
  dismissNotification: () => {},
});

export function useNotification() {
  return useContext(NotificationContext);
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<NotificationData[]>([]);

  const showNotification = useCallback((n: NotificationData) => {
    setQueue((prev) => [...prev, n]);
  }, []);

  const dismissNotification = useCallback(() => {
    setQueue((prev) => prev.slice(1));
  }, []);

  const notification = queue[0] ?? null;

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
