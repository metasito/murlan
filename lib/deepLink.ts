const CODE = /^[A-Z0-9]{4,6}$/;
const JOIN_LINK = /^(?:murlan:\/\/|https?:\/\/[^/]+\/|\/)?join\/([^/?#]*)\/?(?:[?#].*)?$/i;

export function joinCode(code: unknown): string | null {
  if (typeof code !== "string") return null;
  const upper = code.toUpperCase();
  return CODE.test(upper) ? upper : null;
}

/** The single route a join link and a tapped invite push both open: app/join/[code].tsx. */
export function joinRouteFor(code: unknown): string | null {
  const valid = joinCode(code);
  return valid && `/join/${valid}`;
}

export function systemPath(path: string): string {
  const match = JOIN_LINK.exec(path);
  return (match && joinRouteFor(match[1])) ?? "/";
}
