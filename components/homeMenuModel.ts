/**
 * What the home screen offers, given what the player has.
 *
 * Here rather than inline in the screen because "exactly one hero, and the
 * hero is never also a tile" is a rule about a set, and a screen that derives
 * it in JSX can only be checked by looking at it.
 */
export type HomeAction = "resume" | "offline" | "friends" | "online" | "passAndPlay";

/** The four ways to play, in the order they are offered. */
const WAYS_TO_PLAY: HomeAction[] = ["offline", "friends", "online", "passAndPlay"];

export interface HomeTile {
  action: HomeAction;
  /** Offered, but not to this player — it renders with its reason, not a route. */
  disabled: boolean;
}

export interface HomeMenu {
  hero: HomeAction;
  /** The hero leads to signing in rather than to play, and says so. */
  heroNeedsAccount: boolean;
  tiles: HomeTile[];
}

/** The two ways to play that are nothing without an account. */
const NEEDS_ACCOUNT: HomeAction[] = ["friends", "online"];

export function homeMenu(has: { savedGame: boolean; account: boolean }): HomeMenu {
  // A save is the offline game, so it is resumable with no account at all.
  // Without one the hero is `online` itself, which is why the tile list below
  // is a filter and not a subtraction of some separate hero action: promoting
  // a way to play must take it out of the grid, or it is offered twice.
  const hero: HomeAction = has.savedGame ? "resume" : "online";
  return {
    hero,
    heroNeedsAccount: hero === "online" && !has.account,
    tiles: WAYS_TO_PLAY.filter((a) => a !== hero).map((action) => ({
      action,
      disabled: !has.account && NEEDS_ACCOUNT.includes(action),
    })),
  };
}
