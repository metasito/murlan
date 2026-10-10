/** Web has no push (lib/device/pushRegistration.ts), so there is no tap to follow. */
export function followInviteTaps(): () => void {
  return () => {};
}
