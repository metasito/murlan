import { useEffect } from 'react';
import { useBanner, type NotificationData } from '@/context/NotificationContext';

/**
 * Every banner the player is shown, in order: `<BannerLog />`, rendered beside the screen, reads
 * each off the real queue and dismisses it, so the next one queued behind it is read too.
 */
export function bannerLog() {
  const shown: NotificationData[] = [];
  function BannerLog() {
    const { notification, dismissNotification } = useBanner();
    useEffect(() => {
      if (!notification) return;
      shown.push(notification);
      dismissNotification();
    }, [notification, dismissNotification]);
    return null;
  }
  return { shown, BannerLog };
}
