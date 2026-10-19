import { createHash } from "node:crypto";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..", "..");

const options = ts.getParsedCommandLineOfConfigFile(path.join(root, "tsconfig.json"), {}, {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic: (d) => {
    throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
  },
})!.options;

const parsed = new Map<string, ts.SourceFile | undefined>();
let previous: ts.Program | undefined;

export function programFor(roots: string[], override: Record<string, string> = {}): ts.Program {
  const replaced = new Map(Object.entries(override).map(([file, text]) => [path.resolve(root, file), text]));
  const host = ts.createCompilerHost(options);
  const read = host.getSourceFile;
  host.getSourceFile = (file, language, ...rest) => {
    const resolved = path.resolve(file);
    const text = replaced.get(resolved);
    if (text !== undefined) return ts.createSourceFile(file, text, language);
    if (!parsed.has(resolved)) parsed.set(resolved, read(file, language, ...rest));
    return parsed.get(resolved);
  };
  const exists = host.fileExists;
  host.fileExists = (file) => replaced.has(path.resolve(file)) || exists(file);
  previous = ts.createProgram(roots.map((f) => path.resolve(root, f)), options, host, previous);
  return previous;
}

const NOT_JSON = new Set(["Map", "Set", "WeakMap", "WeakSet", "Date", "Promise", "RegExp"]);

export function typeShape(checker: ts.TypeChecker, type: ts.Type): string {
  const stack: ts.Type[] = [];
  const walk = (t: ts.Type, where: string): string => {
    const f = t.flags;
    if (f & ts.TypeFlags.Any) return "any";
    if (f & ts.TypeFlags.Unknown) return "unknown";
    if (f & ts.TypeFlags.Never) return "never";
    if (f & (ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral | ts.TypeFlags.BooleanLiteral)) {
      return checker.typeToString(t);
    }
    if (f & (ts.TypeFlags.String | ts.TypeFlags.Number | ts.TypeFlags.Boolean | ts.TypeFlags.Null | ts.TypeFlags.Undefined)) {
      return checker.typeToString(t);
    }
    if (f & ts.TypeFlags.Union) {
      return [...new Set((t as ts.UnionType).types.map((m) => walk(m, where)))].sort().join(" | ");
    }
    if (!(f & (ts.TypeFlags.Object | ts.TypeFlags.Intersection))) {
      throw new Error(`not JSON: ${where} is ${checker.typeToString(t)}`);
    }
    const back = stack.indexOf(t);
    if (back >= 0) return `<^${stack.length - back}>`;
    const name = (t.aliasSymbol ? undefined : t.getSymbol())?.getName();
    if (
      (name && NOT_JSON.has(name)) ||
      t.getCallSignatures().length > 0 ||
      t.getConstructSignatures().length > 0 ||
      (t.getSymbol()?.flags ?? 0) & ts.SymbolFlags.Class
    ) {
      throw new Error(`not JSON: ${where} is ${checker.typeToString(t)}`);
    }
    stack.push(t);
    try {
      if (checker.isTupleType(t)) {
        const target = (t as ts.TupleTypeReference).target;
        const elements = checker.getTypeArguments(t as ts.TypeReference).slice(0, target.elementFlags.length).map((e, i) => {
          const flag = target.elementFlags[i];
          const shape = walk(e, `${where}[${i}]`);
          return flag & ts.ElementFlags.Rest ? `...${shape}[]` : flag & ts.ElementFlags.Optional ? `${shape}?` : shape;
        });
        return `[${elements.join(", ")}]`;
      }
      if (checker.isArrayType(t)) {
        return `(${walk(checker.getTypeArguments(t as ts.TypeReference)[0], `${where}[]`)})[]`;
      }
      const members = checker.getIndexInfosOfType(t).map(
        (info) => `[${checker.typeToString(info.keyType)}]: ${walk(info.type, `${where}[]`)}`
      );
      const props = checker.getPropertiesOfType(t).map((p) => {
        const optional = p.flags & ts.SymbolFlags.Optional ? "?" : "";
        return `${JSON.stringify(p.getName())}${optional}: ${walk(checker.getTypeOfSymbol(p), `${where}.${p.getName()}`)}`;
      });
      return `{${[...members.sort(), ...props.sort()].join("; ")}}`;
    } finally {
      stack.pop();
    }
  };
  return walk(type, "<root>");
}

export const shapeHash = (shape: string): string => createHash("sha256").update(shape).digest("hex");
