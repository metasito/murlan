import path from "node:path";
import { GAME_SCHEMA_VERSION } from "../../shared/persistedEnvelope.ts";
import { OFFLINE_SAVE_VERSION } from "../../lib/offlineSave.ts";
import { PROTOCOL_VERSION } from "../../shared/protocol.ts";
import { programFor, shapeHash, typeShape } from "./typeShape.ts";

const root = path.resolve(import.meta.dirname, "..", "..");

export const STORED_SHAPES = "tests/fixtures/storedShapes.json";

const PROBE = "tests/server/storedShapeProbe.ts";
const PROBE_TEXT = [
  `import type { toEnvelope } from "../../server/game/tableState.ts";`,
  `import type { OfflineSave } from "../../lib/offlineSave.ts";`,
  `import type { ClientToServerEvents, ServerToClientEvents } from "../../shared/protocol.ts";`,
  `type Sent<A> = { [I in keyof A]: A[I] extends (...reply: infer R) => void ? R : A[I] };`,
  `type Payloads<M> = { [E in keyof M]: M[E] extends (...args: infer A) => void ? Sent<A> : never };`,
  `export type activeGames = ReturnType<typeof toEnvelope>;`,
  `export type offlineSave = OfflineSave;`,
  `export type wire = { toClient: Payloads<ServerToClientEvents>; toServer: Payloads<ClientToServerEvents> };`,
].join("\n");

export const DOCUMENTS = {
  activeGames: {
    version: GAME_SCHEMA_VERSION,
    bump: "GAME_SCHEMA_VERSION in shared/persistedEnvelope.ts",
    golden: "",
  },
  offlineSave: {
    version: OFFLINE_SAVE_VERSION,
    bump: "OFFLINE_SAVE_VERSION in lib/offlineSave.ts",
    golden: " Regenerate tests/fixtures/offlineSave.json through encodeOfflineSave.",
  },
  wire: {
    version: PROTOCOL_VERSION,
    bump: "PROTOCOL_VERSION in shared/protocol.ts",
    golden: " Raise MIN_PROTOCOL_VERSION if bundles in the field cannot read the change.",
  },
} as const;
export type Document = keyof typeof DOCUMENTS;

export function shapes(override: Record<string, string> = {}): Record<Document, string> {
  const program = programFor([PROBE], { [PROBE]: PROBE_TEXT, ...override });
  const checker = program.getTypeChecker();
  const probe = program.getSourceFile(path.join(root, PROBE))!;
  const exports = checker.getExportsOfModule(checker.getSymbolAtLocation(probe)!);
  const shapeOf = (name: Document) =>
    typeShape(checker, checker.getDeclaredTypeOfSymbol(exports.find((s) => s.name === name)!));
  return { activeGames: shapeOf("activeGames"), offlineSave: shapeOf("offlineSave"), wire: shapeOf("wire") };
}

export const shapeHashes = (override?: Record<string, string>): Record<Document, string> => {
  const s = shapes(override);
  return { activeGames: shapeHash(s.activeGames), offlineSave: shapeHash(s.offlineSave), wire: shapeHash(s.wire) };
};
