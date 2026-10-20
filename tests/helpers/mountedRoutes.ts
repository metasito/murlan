import type { Express } from "express";

export interface MountedRoute {
  /** `POST /api/friends/add`: the verb and the path as Express holds it. */
  route: string;
  /** Every layer of the route, in the order a request meets them. */
  handles: unknown[];
}

interface Layer {
  name: string;
  handle: { stack?: unknown };
  route?: { path: unknown; methods: Record<string, boolean>; stack: { handle: unknown }[] };
}

/**
 * Every route the live app answers, read from its router rather than from any
 * source file, so a route mounted anywhere is seen. Every other layer is
 * accounted for too: an `app.use` middleware must be named in `passThrough`, or
 * the walk throws — Express 5 keeps no mount path on a layer, so a middleware
 * that answers under /api is indistinguishable from one that passes through
 * except by being known. A nested Router is refused for the same reason.
 */
export function mountedRoutes(app: Express, passThrough: ReadonlySet<string> = new Set()): MountedRoute[] {
  const stack = (app.router as unknown as { stack: Layer[] }).stack;
  const found: MountedRoute[] = [];
  for (const layer of stack) {
    if (!layer.route) {
      if (Array.isArray(layer.handle.stack)) throw new Error("a nested Router is mounted, and its routes cannot be walked");
      if (!passThrough.has(layer.name)) {
        throw new Error(`middleware "${layer.name}" is not a known pass-through, so it may answer outside the route table`);
      }
      continue;
    }
    const { path, methods, stack: layers } = layer.route;
    if (typeof path !== "string") throw new Error(`a route is mounted on a non-string path: ${String(path)}`);
    for (const method of Object.keys(methods).filter((m) => methods[m])) {
      found.push({ route: `${method.toUpperCase()} ${path}`, handles: layers.map((l) => l.handle) });
    }
  }
  return found;
}
