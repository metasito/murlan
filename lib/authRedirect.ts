/**
 * Where to land once the account exists. A trust boundary: on the web `next`
 * arrives in the URL, so anything but a single in-app absolute path falls back
 * to home rather than being handed to the router.
 */
export function destinationAfterAuth(next: string | undefined): string {
  if (!next) return "/";
  if (!/^\/(?!\/)[\w\-./()[\]?&=%]*$/.test(next)) return "/";
  return next;
}
