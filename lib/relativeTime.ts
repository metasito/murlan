import type { TFn, TnFn } from "./i18n";

/**
 * How long ago, in the phrasing the friends list established. The keys are
 * `friends.time*` because that screen named them first; they say nothing about
 * friends and every screen showing an instant reads them.
 */
export function relativeTime(
  isoString: string | null | undefined,
  t: TFn,
  tn: TnFn
): string {
  if (!isoString) return t("friends.timeUnknown");
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t("friends.timeJustNow");
  if (mins < 60) return t("friends.timeMinutesAgo", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return tn("friends.timeHoursAgo", hours);
  const days = Math.floor(hours / 24);
  return tn("friends.timeDaysAgo", days);
}
