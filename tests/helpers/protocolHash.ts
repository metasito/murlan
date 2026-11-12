import { createHash } from "node:crypto";
import ts from "typescript";

export const PROTOCOL_HASHES = "tests/fixtures/protocolHashes.json";

/** Hashes the tokens bar module paths, so a comment or a moved import — neither reaches the wire — needs no bump. */
export function protocolHash(source: string): string {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source);
  const tokens: string[] = [];
  while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) {
    const modulePath = scanner.getToken() === ts.SyntaxKind.StringLiteral && ["from", "import"].includes(tokens.at(-1) ?? "");
    tokens.push(modulePath ? "<module>" : scanner.getTokenText());
  }
  return createHash("sha256").update(tokens.join(" ")).digest("hex");
}
