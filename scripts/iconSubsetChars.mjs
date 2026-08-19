/**
 * Every @expo/vector-icons glyph name the app can render, and the characters
 * they map to.
 *
 * A regex-based scan cannot tell a resolvable `name={…}` from an unresolvable
 * one without also being able to resolve it — a scan that judges shape in
 * isolation from resolution is exactly how this file twice shipped a subset
 * silently missing real names (a ternary/table literal the first version
 * never looked for; `"pause"`, reached only through a plain function
 * parameter, in the second). So there is one resolver, `resolveValues`, and
 * both what ships (`iconNames`/`iconCharacters`) and what tests/iconSubset.test.ts
 * asserts (`analyzeIcons(...).unresolved`) read the same pass over the same
 * AST — they cannot disagree with each other the way two independently
 * written regexes did.
 *
 * `resolveValues` is real TypeScript parsing (the `typescript` package,
 * already a dependency), not a better regex: following a prop from its JSX
 * attribute, through a component's parameter, back out to every call site —
 * across files, through `useMemo`/local function calls, through a `.map()`
 * callback's source array, through a `useState` pair and its setter calls —
 * is scope- and binding-aware data flow that a regular expression cannot
 * carry honestly. It walks no further than the shapes this app actually
 * uses; anything else (a template string, concatenation, a call this can't
 * follow, a computed index used directly in the prop) resolves to `null`,
 * and null is contagious — one unresolved branch fails the whole expression
 * rather than silently under-counting.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const SOURCE_DIRS = ["app", "components", "lib", "context"];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

function unwrap(node) {
  for (;;) {
    if (ts.isParenthesizedExpression(node)) { node = node.expression; continue; }
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)) {
      node = node.expression;
      continue;
    }
    return node;
  }
}

function isNullish(node) {
  return node.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(node) && node.text === "undefined");
}

function findNameInBindingName(bindingName, name) {
  if (ts.isIdentifier(bindingName)) return bindingName.text === name;
  if (ts.isObjectBindingPattern(bindingName) || ts.isArrayBindingPattern(bindingName)) {
    return bindingName.elements.some(
      (el) => ts.isBindingElement(el) && ts.isIdentifier(el.name) && el.name.text === name
    );
  }
  return false;
}

/** The `X` in `X.map(fn)`/`X.forEach(fn)`/`X.find(fn)`, when `fn` is that call's own callback. */
function mapCallbackCollection(fnNode) {
  const call = fnNode.parent;
  if (!call || !ts.isCallExpression(call) || !call.arguments.includes(fnNode)) return null;
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee)) return null;
  if (!["map", "forEach", "find"].includes(callee.name.text)) return null;
  return callee.expression;
}

/** The name a function-like node is bound to — `function Foo(...)` or `const Foo = (...) => ...`. */
function functionLikeDeclaredName(fnNode) {
  if (ts.isFunctionDeclaration(fnNode) && fnNode.name) return fnNode.name.text;
  if (fnNode.parent && ts.isVariableDeclaration(fnNode.parent) && ts.isIdentifier(fnNode.parent.name)) {
    return fnNode.parent.name.text;
  }
  return null;
}

function attrValueExpr(attr) {
  if (!attr.initializer) return null; // boolean-shorthand attribute
  if (ts.isStringLiteral(attr.initializer)) return attr.initializer;
  if (ts.isJsxExpression(attr.initializer)) return attr.initializer.expression ?? null;
  return null;
}

function findJsxAttribute(attrs, propName) {
  for (const a of attrs.properties) {
    if (ts.isJsxAttribute(a) && ts.isIdentifier(a.name) && a.name.text === propName) return a;
  }
  return null; // absent, or only reachable through a spread — either way, cannot vouch for it
}

/** Walks outward from a use site to what binds its name: a variable, a `useState` pair, or a parameter. */
function findBinding(idNode) {
  const name = idNode.text;
  let node = idNode;
  while (node.parent) {
    const parent = node.parent;

    if (ts.isFunctionLike(parent) && parent.parameters) {
      const idx = parent.parameters.findIndex((p) => findNameInBindingName(p.name, name));
      if (idx !== -1) return { kind: "param", fnNode: parent, paramIndex: idx, paramName: name };
    }

    if (ts.isBlock(parent) || ts.isSourceFile(parent)) {
      for (const stmt of parent.statements) {
        if (!ts.isVariableStatement(stmt)) continue;
        for (const decl of stmt.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.name.text === name && decl.initializer) {
            return { kind: "var", initializer: decl.initializer };
          }
          if (
            ts.isArrayBindingPattern(decl.name) &&
            decl.initializer &&
            ts.isCallExpression(decl.initializer) &&
            ts.isIdentifier(decl.initializer.expression) &&
            decl.initializer.expression.text === "useState"
          ) {
            const [valueEl, setterEl] = decl.name.elements;
            if (
              valueEl &&
              ts.isBindingElement(valueEl) &&
              ts.isIdentifier(valueEl.name) &&
              valueEl.name.text === name
            ) {
              return {
                kind: "useState",
                initialArg: decl.initializer.arguments[0] ?? null,
                setterName:
                  setterEl && ts.isBindingElement(setterEl) && ts.isIdentifier(setterEl.name)
                    ? setterEl.name.text
                    : null,
              };
            }
          }
        }
      }
    }

    node = parent;
  }
  return null;
}

/**
 * Every literal an expression is ultimately built from, `null` if any part
 * of it is not one of the shapes this resolves. `seen` blocks a binding
 * cycle rather than a stack overflow.
 */
function resolveValues(rawNode, ctx, seen) {
  const node = unwrap(rawNode);
  if (seen.has(node)) return null;
  seen.add(node);
  try {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node];
    if (isNullish(node)) return [node];
    if (ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node)) return [node];

    if (ts.isConditionalExpression(node)) {
      const a = resolveValues(node.whenTrue, ctx, seen);
      const b = resolveValues(node.whenFalse, ctx, seen);
      return a && b ? [...a, ...b] : null;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      const a = resolveValues(node.left, ctx, seen);
      const b = resolveValues(node.right, ctx, seen);
      return a && b ? [...a, ...b] : null;
    }
    if (ts.isIdentifier(node)) return resolveIdentifierValues(node, ctx, seen);
    if (ts.isPropertyAccessExpression(node)) return resolvePropertyAccessValues(node, ctx, seen);
    if (ts.isElementAccessExpression(node)) return resolveIndexedAccess(node.expression, ctx, seen);
    if (ts.isCallExpression(node)) return resolveCallValues(node, ctx, seen);
    return null;
  } finally {
    seen.delete(node);
  }
}

function resolveArrayElements(arrayExpr, ctx, seen) {
  const arrays = resolveValues(arrayExpr, ctx, seen);
  if (!arrays) return null;
  const out = [];
  for (const a of arrays) {
    if (!ts.isArrayLiteralExpression(a)) return null;
    for (const el of a.elements) {
      if (ts.isSpreadElement(el)) return null;
      const r = resolveValues(el, ctx, seen);
      if (!r) return null;
      out.push(...r);
    }
  }
  return out;
}

/**
 * `TABLE[key]` where TABLE is either shape a computed index sees in this app:
 * a plain array (`POSITION_ICONS[rank]`) or a `Record`-style object
 * (`ICON_MAP[notification.type]`). The key is not known statically, so every
 * element/value the table holds is taken — an over-approximation, not a
 * guess at which one.
 */
function resolveIndexedAccess(baseExpr, ctx, seen) {
  const bases = resolveValues(baseExpr, ctx, seen);
  if (!bases) return null;
  const out = [];
  for (const b of bases) {
    if (ts.isArrayLiteralExpression(b)) {
      for (const el of b.elements) {
        if (ts.isSpreadElement(el)) return null;
        const r = resolveValues(el, ctx, seen);
        if (!r) return null;
        out.push(...r);
      }
    } else if (ts.isObjectLiteralExpression(b)) {
      for (const p of b.properties) {
        if (!ts.isPropertyAssignment(p)) return null;
        const r = resolveValues(p.initializer, ctx, seen);
        if (!r) return null;
        out.push(...r);
      }
    } else {
      return null;
    }
  }
  return out;
}

function resolvePropertyAccessValues(node, ctx, seen) {
  const objs = resolveValues(node.expression, ctx, seen);
  if (!objs) return null;
  const propName = node.name.text;
  const out = [];
  for (const obj of objs) {
    if (isNullish(obj)) continue; // `x && x.prop` / `x ? x.prop : …` never reaches `.prop` when x is nullish
    if (!ts.isObjectLiteralExpression(obj)) return null;
    const prop = obj.properties.find(
      (p) =>
        ts.isPropertyAssignment(p) &&
        p.name &&
        (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
        p.name.text === propName
    );
    if (!prop) return null;
    const r = resolveValues(prop.initializer, ctx, seen);
    if (!r) return null;
    out.push(...r);
  }
  return out;
}

/** Resolves a parameter through however this codebase actually binds it: a `.map()` element, or an invocation (JSX or a plain call), by name or by position. */
function resolveParamValues(fnNode, paramIndex, paramName, ctx, seen) {
  const collection = mapCallbackCollection(fnNode);
  if (collection) return resolveArrayElements(collection, ctx, seen);

  const name = functionLikeDeclaredName(fnNode);
  if (!name) return null;

  const jsxSites = ctx.callSitesByComponent.get(name) ?? [];
  const callSites = ctx.callArgsByName.get(name) ?? [];
  if (jsxSites.length === 0 && callSites.length === 0) return null;

  const out = [];
  for (const attrs of jsxSites) {
    const attr = findJsxAttribute(attrs, paramName);
    if (!attr) return null;
    const expr = attrValueExpr(attr);
    if (!expr) return null;
    const r = resolveValues(expr, ctx, seen);
    if (!r) return null;
    out.push(...r);
  }
  for (const call of callSites) {
    const argExpr = call.arguments[paramIndex];
    if (!argExpr) return null;
    const r = resolveValues(argExpr, ctx, seen);
    if (!r) return null;
    out.push(...r);
  }
  return out;
}

function resolveIdentifierValues(idNode, ctx, seen) {
  const binding = findBinding(idNode);
  if (!binding) return null;
  if (binding.kind === "var") return resolveValues(binding.initializer, ctx, seen);
  if (binding.kind === "param") return resolveParamValues(binding.fnNode, binding.paramIndex, binding.paramName, ctx, seen);
  if (binding.kind === "useState") {
    const out = [];
    if (binding.initialArg) {
      const r = resolveValues(binding.initialArg, ctx, seen);
      if (!r) return null;
      out.push(...r);
    }
    if (binding.setterName) {
      for (const call of ctx.callArgsByName.get(binding.setterName) ?? []) {
        const arg = call.arguments[0];
        if (!arg) return null;
        const r = resolveValues(arg, ctx, seen);
        if (!r) return null;
        out.push(...r);
      }
    }
    return out;
  }
  return null;
}

function resolveFunctionReturn(fnNode, ctx, seen) {
  if (!ts.isBlock(fnNode.body)) return resolveValues(fnNode.body, ctx, seen); // expression-bodied arrow
  const out = [];
  let ok = true;
  const visit = (n) => {
    if (!ok) return;
    if (n !== fnNode.body && ts.isFunctionLike(n)) return; // don't cross into a nested function's own returns
    if (ts.isReturnStatement(n)) {
      const r = n.expression ? resolveValues(n.expression, ctx, seen) : null;
      if (!r) { ok = false; return; }
      out.push(...r);
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(fnNode.body);
  return ok ? out : null;
}

function resolveCallValues(node, ctx, seen) {
  const callee = node.expression;
  const calleeName = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
  if (!calleeName) return null;

  if (calleeName === "useMemo" || calleeName === "useCallback") {
    const fn = node.arguments[0];
    return fn && ts.isFunctionLike(fn) ? resolveFunctionReturn(fn, ctx, seen) : null;
  }
  const fnDecl = ctx.functionsByName.get(calleeName);
  return fnDecl ? resolveFunctionReturn(fnDecl, ctx, seen) : null;
}

function recordJsxCallSite(ctx, opening) {
  if (!ts.isIdentifier(opening.tagName)) return;
  const tag = opening.tagName.text;
  if (!/^[A-Z]/.test(tag)) return; // a host element (div, etc. — lowercase), never a component
  if (!ctx.callSitesByComponent.has(tag)) ctx.callSitesByComponent.set(tag, []);
  ctx.callSitesByComponent.get(tag).push(opening.attributes);
}

function buildIndex(parsedFiles) {
  const ctx = {
    callSitesByComponent: new Map(),
    callArgsByName: new Map(),
    functionsByName: new Map(),
  };
  for (const { sf } of parsedFiles) {
    const visit = (node) => {
      if (ts.isJsxElement(node)) recordJsxCallSite(ctx, node.openingElement);
      else if (ts.isJsxSelfClosingElement(node)) recordJsxCallSite(ctx, node);

      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const n = node.expression.text;
        if (!ctx.callArgsByName.has(n)) ctx.callArgsByName.set(n, []);
        ctx.callArgsByName.get(n).push(node);
      }

      if (ts.isFunctionDeclaration(node) && node.name) {
        ctx.functionsByName.set(node.name.text, node);
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      ) {
        ctx.functionsByName.set(node.name.text, node.initializer);
      }

      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return ctx;
}

function parseAll(repoRoot) {
  return SOURCE_DIRS.flatMap((d) => walk(path.join(repoRoot, d))).map((file) => ({
    file,
    sf: ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
  }));
}

/**
 * The one pass everything else reads: every glyph name the app resolves to a
 * literal, by family, plus every `name={…}` this could not resolve.
 * `describeFile` names a parsed entry for `unresolved`'s file/line; absent
 * for a synthetic snippet with no path of its own (see `analyzeSnippet`).
 */
function analyzeParsed(parsed, describeFile) {
  const ctx = buildIndex(parsed);

  const found = { Ionicons: new Set(), Feather: new Set() };
  const unresolved = [];

  for (const { file, sf } of parsed) {
    const visit = (node) => {
      const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
      if (opening && ts.isIdentifier(opening.tagName) && (opening.tagName.text === "Ionicons" || opening.tagName.text === "Feather")) {
        const family = opening.tagName.text;
        const nameAttr = findJsxAttribute(opening.attributes, "name");
        if (nameAttr) {
          const expr = attrValueExpr(nameAttr);
          const result = expr && resolveValues(expr, ctx, new Set());
          const allStrings = result && result.every((n) => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n));
          if (allStrings) {
            for (const n of result) found[family].add(n.text);
          } else {
            const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
            unresolved.push({
              file: describeFile ? describeFile(file) : file,
              line: pos.line + 1,
              family,
              expr: expr ? expr.getText(sf) : "(none)",
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  return {
    Ionicons: [...found.Ionicons].sort(),
    Feather: [...found.Feather].sort(),
    unresolved,
  };
}

export function analyzeIcons(repoRoot) {
  return analyzeParsed(parseAll(repoRoot), (file) => path.relative(repoRoot, file).split(path.sep).join("/"));
}

/**
 * Runs the same resolution a real file gets, on an in-memory TSX snippet —
 * so the resolver's accept/reject behaviour is a unit under test in its own
 * right, not just observed indirectly through whatever this app currently
 * contains.
 */
export function analyzeSnippet(source) {
  const sf = ts.createSourceFile("snippet.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return analyzeParsed([{ file: "snippet.tsx", sf }]);
}

export function iconNames(repoRoot) {
  const { Ionicons, Feather } = analyzeIcons(repoRoot);
  return { Ionicons, Feather };
}

export function iconCharacters(repoRoot) {
  const names = iconNames(repoRoot);
  const out = {};
  for (const family of ["Ionicons", "Feather"]) {
    const glyphMap = JSON.parse(
      readFileSync(
        path.join(
          repoRoot,
          "node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps",
          `${family}.json`
        ),
        "utf8"
      )
    );
    const chars = names[family]
      .filter((n) => glyphMap[n] !== undefined)
      .map((n) => String.fromCodePoint(glyphMap[n]));
    out[family] = [...new Set(chars)].join("");
  }
  return out;
}
