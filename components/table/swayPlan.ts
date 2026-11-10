// How each platform draws the felt's sway (rest architecture § 2.2): the one place the shape is chosen.
// N0 is today's: the felt shader redrawn live as the lamp moves. D2 moves web to the compositor
// crossfade; D3 moves native only on the PR 0 evidence (RESULT.md), and N0 is the fallback it degrades to.
//
// JSX-free, no imports — docs/agents/checks.md, "Node's TypeScript loader".

export type SwayShape = "N0" | "N1" | "N2" | "compositor";
export type SwayPlatform = "web" | "ios" | "android";

export const SWAY_PLAN: Readonly<Record<SwayPlatform, SwayShape>> = {
  web: "N0",
  ios: "N0",
  android: "N0",
};

export function swayShape(platform: string): SwayShape {
  return platform in SWAY_PLAN ? SWAY_PLAN[platform as SwayPlatform] : "N0";
}
