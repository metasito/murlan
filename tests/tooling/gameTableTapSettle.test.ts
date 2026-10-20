// tests/tooling/gameTableTapSettle.test.ts — Maestro's default wait after a tap is "wait for
// the view hierarchy to stop changing", and the game table's Reanimated glow and pulse
// never stop, so that wait runs to its internal timeout on every tap that lands there.
// `waitToSettleTimeoutMs` caps it. The flows have carried the cap on the taps *inside*
// the table since it was first diagnosed; what hung the Android run was the tap that
// *opens* it, which is the last tap of the menu and so sat outside a rule written by
// section (#762).
//
// The boundary is taken from the flow rather than named here: a flow that enters the
// table rotates the device for it, and says so. That means a flow reordered around
// that line moves this check with it instead of leaving it pointing at a tap that is
// no longer the one crossing over.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseAllDocuments } from "yaml";

const FLOW_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".maestro");

type Command = { name: string; value: unknown };

/** A flow file's commands: the document after its config header. */
function commandsOf(file: string): unknown[] {
  const docs = parseAllDocuments(readFileSync(path.join(FLOW_DIR, file), "utf8")).map((d) => d.toJS());
  return (docs.at(-1) as unknown[]) ?? [];
}

/** Every command a flow runs, in order: nested blocks opened, and each `_*.yaml` sibling it runs in place. */
function flatten(commands: unknown[]): Command[] {
  return commands.flatMap((command): Command[] => {
    if (typeof command === "string") return [{ name: command, value: null }];
    const [name, value] = Object.entries(command as Record<string, unknown>)[0];
    const body = value as { file?: string; commands?: unknown[] } | string | null;
    if (name === "runFlow") {
      const file = typeof body === "string" ? body : body?.file;
      if (file && /^_\w+\.yaml$/.test(file)) return flatten(commandsOf(file));
    }
    if (body && typeof body === "object" && Array.isArray(body.commands)) return flatten(body.commands);
    return [{ name, value }];
  });
}

/**
 * Flows that enter the game table, which is the only screen locked to landscape —
 * so a flow turning the device that way is on its way there, and one turning it to
 * portrait (`smoke.yaml`, for the menus below the fold) is not.
 */
function flowsReachingTheTable(): { name: string; commands: Command[]; rotation: number }[] {
  const found = [];
  for (const name of readdirSync(FLOW_DIR).filter((f) => /\.ya?ml$/.test(f))) {
    const commands = flatten(commandsOf(name));
    const rotation = commands.findIndex((c) => c.name === "setOrientation" && JSON.stringify(c.value).includes("LANDSCAPE"));
    if (rotation !== -1) found.push({ name, commands, rotation });
  }
  return found;
}

describe("taps that land on the game table", () => {
  test("at least one flow enters the table, or this check is watching nothing", () => {
    // The whole file passes vacuously if the rotation it keys on is ever renamed or
    // dropped, and a green suite would then be reporting a rule nothing applies.
    assert.notEqual(
      flowsReachingTheTable().length,
      0,
      `no flow under .maestro/ rotates the device, so nothing here located the game ` +
        `table. If the flows now enter it another way, key this check on that instead.`
    );
  });

  for (const { name, commands, rotation } of flowsReachingTheTable()) {
    test(`${name} caps the settle wait from the tap that opens the table onward`, () => {
      const taps = commands.flatMap((c, at) => (c.name === "tapOn" ? [{ at, value: c.value }] : []));
      const opening = taps.filter((t) => t.at < rotation).pop();
      assert.ok(opening, `${name} rotates for the table without a tap ever opening it`);

      const uncapped = taps
        .filter((t) => t.at >= opening.at)
        .filter((t) => (t.value as { waitToSettleTimeoutMs?: number } | null)?.waitToSettleTimeoutMs === undefined)
        .map((t) => `${name}, command ${t.at + 1}: tapOn ${JSON.stringify(t.value)}`);

      assert.deepEqual(
        uncapped,
        [],
        `these taps land on the game table and let Maestro wait for a screen whose ` +
          `animations never stop, which is a hang rather than a failure — the run ends ` +
          `mid-command with the element found and aimed at. Pin waitToSettleTimeoutMs on ` +
          `each, as the taps below them already do.`
      );
    });
  }
});
