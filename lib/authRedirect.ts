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

/** Where `useSegments()` and `useGlobalSearchParams()` say the player is, as the `next` for `/auth`. */
export function returnPathFor(
  segments: readonly string[],
  params: Readonly<Record<string, string | string[] | undefined>>
): string {
  const place = segments[segments.length - 1] === "index" ? segments.slice(0, -1) : segments;
  const query = Object.entries(params)
    .flatMap(([key, value]) => (value === undefined ? [] : [value].flat().map((v) => [key, v] as const)))
    .map(([key, v]) => `${encodeURIComponent(key)}=${encodeURIComponent(v)}`)
    .join("&");
  return destinationAfterAuth(`/${place.join("/")}${query ? `?${query}` : ""}`);
}
