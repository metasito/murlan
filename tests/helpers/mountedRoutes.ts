import type { Express } from "express";

export interface MountedRoute {
  /** `POST /api/friends/add`: the verb and the path as Express holds it. */
  route: string;
  /** Every layer of the route, in the order a request meets them. */
  handles: unknown[];
}

interface Layer {
  handle: { stack?: unknown };
  route?: { path: unknown; methods: Record<string, boolean>; stack: { handle: unknown }[] };
}

/**
 * Every route the live app answers, read from its router rather than from any
 * source file, so a route mounted anywhere is seen. A nested Router is refused:
 * its mount path is not recoverable from Express 5's layers, and skipping it
 * would hide every route under it.
 */
export function mountedRoutes(app: Express): MountedRoute[] {
  const stack = (app.router as unknown as { stack: Layer[] }).stack;
  const found: MountedRoute[] = [];
  for (const layer of stack) {
    if (!layer.route) {
      if (Array.isArray(layer.handle.stack)) throw new Error("a nested Router is mounted, and its routes cannot be walked");
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
