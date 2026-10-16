// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

/** `live` while the state that raised it stands: the region's text goes with it, so the next float is a change. */
export type Float = { id: number; kind: "pass" | "autoPass" | "reject" | "toast"; text: string; live: boolean };

/** What changed under the float in one commit; a field is absent when its input did not change. */
export type FloatInput = {
  /** The game state moved: whether that move was the viewer's own pass. */
  viewerPassed?: boolean;
  /** The error changed, to this; `null` when it cleared. */
  error?: { text: string } | null;
  autoPassed?: boolean;
  withdrawn: boolean;
  /** `withdrawn` just turned on. */
  withdrew?: boolean;
};

export const raised = (standing: Float | null, kind: Float["kind"], text: string, live = true): Float => ({
  id: (standing?.id ?? 0) + 1,
  kind,
  text,
  live,
});

export function nextFloat(
  prev: Float | null,
  input: FloatInput,
  labels: { passed: string; autoPass: string },
): Float | null {
  let float = prev;
  if (input.viewerPassed) float = raised(float, "pass", labels.passed, !input.withdrawn);
  else if (input.viewerPassed === false && float?.live) float = { ...float, live: false };
  if (input.error) float = raised(float, "toast", input.error.text, !input.withdrawn);
  else if (input.error === null && float?.kind === "toast" && float.live) float = { ...float, live: false };
  // The state lands no later than the notice (offline one batch, online the server's order). Only a pass is
  // re-titled, in its own life: a timed-out lead is a card the server played, and raises nothing.
  if (input.autoPassed && float?.kind === "pass" && float.live) float = { ...float, kind: "autoPass", text: labels.autoPass };
  if (input.withdrew && float?.live) float = { ...float, live: false };
  return float;
}
