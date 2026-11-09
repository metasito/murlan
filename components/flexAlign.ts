// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

/** How a flex container places a child across its cross axis. */
export type Align = "flex-start" | "center" | "flex-end";

/** Where a child `size` long starts in a container's `room` from `start`, as `align` places it. */
export function aligned(align: Align, start: number, room: number, size: number): number {
  return start + (align === "flex-start" ? 0 : align === "flex-end" ? room - size : (room - size) / 2);
}
