import { jest } from '@jest/globals';
import type { NotificationData } from '@/context/NotificationContext';

/**
 * The module a `jest.mock('@/context/NotificationContext', ...)` hands back:
 * the production `notifyError`/`notifyServerError`, over a `showNotification`
 * that reaches `sink()`. The sink is read at call time so a `mock`-prefixed
 * const declared after the imports is not touched before it exists.
 */
export function notificationContextMock(sink: () => (n: NotificationData) => void = () => () => {}) {
  const { createNotifyCommands } = jest.requireActual<typeof import('@/context/NotificationContext')>(
    '@/context/NotificationContext'
  );
  const commands = createNotifyCommands((n) => sink()(n));
  const banner = {
    notification: null,
    dismissNotification: () => {},
    bannerBottom: 0,
    reportBannerBottom: () => {},
  };
  return {
    useNotification: () => commands,
    useBanner: () => banner,
    useBannerBottom: () => 0,
  };
}
