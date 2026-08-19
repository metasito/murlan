/**
 * Every @expo/vector-icons glyph name the app can render, and the characters
 * they map to.
 *
 * Names arrive several ways: a literal `name="trophy"` prop; a literal
 * ternary branch written inline (`name={open ? "chevron-up" : "chevron-down"}`,
 * however deeply nested); a literal in a table the props read (`icon: "x"`
 * in an object, or a `const X = [...]` array); or a plain identifier/member
 * access (`name={icon}`, `name={mode.icon}`) whose value is one of the above,
 * found either directly (the JSX site) or one `const`/`let` hop away in the
 * same file. A name assembled some other way — a template string,
 * concatenation, a call, a computed index used directly in the prop — cannot
 * be resolved this way, so tests/iconSubset.test.ts refuses it rather than
 * silently shipping a subset that might be missing it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SOURCE_DIRS = ["app", "components", "lib", "context"];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

// Every quoted literal immediately after a `?` or `:` — a ternary's branches,
// however deeply nested, since each one independently matches. A comparison
// in the *condition* (`kind === "complete" ? …`) is never preceded by `?`/`:`
// so it is never mistaken for a branch. Also matches an object literal's
// `key: "value"` entries and a `TABLE[i] ?? "fallback"` fallback, both used
// below for the same reason: nothing here needs a real parser, just "what
// immediately follows a `?` or `:`".
function ternaryLiterals(text) {
  return [...text.matchAll(/[?:]\s*"([a-zA-Z0-9-]+)"/g)].map((m) => m[1]);
}

export function iconNames(repoRoot) {
  const found = { Ionicons: new Set(), Feather: new Set() };
  const files = SOURCE_DIRS.flatMap((d) => walk(path.join(repoRoot, d)));

  for (const file of files) {
    const src = readFileSync(file, "utf8");

    for (const m of src.matchAll(
      /<(Ionicons|Feather)\b[^>]*?\bname=(?:"([a-zA-Z0-9-]+)"|\{([^}]+)\})/gs
    )) {
      const family = m[1];
      if (m[2] !== undefined) {
        found[family].add(m[2]);
        continue;
      }
      // Strip a trailing TS `as <Type>` cast first, so a cast like
      // `icon as React.ComponentProps<typeof Ionicons>["name"]` never has its
      // own `"name"` type index mistaken for a branch.
      const expr = m[3].replace(/\s+as\s+[\s\S]+$/, "");
      for (const lit of ternaryLiterals(expr)) found[family].add(lit);
    }

    // icon: "x" / icon="x" in the tables and components those props read
    // (ModeOption.icon, StatTile/EmptyBlock's `icon` prop). Attributed to
    // Ionicons: every such table in this app feeds an <Ionicons>, and a name
    // that is not in its glyphMap is caught by the test rather than silently
    // subsetted into the wrong face.
    for (const m of src.matchAll(/\bicon[:=]\s*"([a-zA-Z0-9-]+)"/g)) {
      found.Ionicons.add(m[1]);
    }

    // A `const`/`let` whose own name says it holds an icon — `icon`,
    // `modeIcon`, `ICON_MAP` — collects literals the same way as above. One
    // of them may read a plain array through a computed index
    // (`POSITION_ICONS[rank]`) whose own name does not say "icon"; that one
    // hop is resolved by reading every same-file declaration the expression
    // names and taking the array's entries whole, since which one `rank`
    // selects is not known statically.
    const decls = new Map();
    for (const m of src.matchAll(
      /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*((?!\()[\s\S]+?);(?:\r?\n|$)/g
    )) {
      decls.set(m[1], m[2]);
    }
    for (const [name, rhs] of decls) {
      if (!/icon/i.test(name)) continue;
      for (const lit of ternaryLiterals(rhs)) found.Ionicons.add(lit);
      for (const ref of new Set(rhs.match(/[A-Za-z_$][\w$]*/g) ?? [])) {
        const table = decls.get(ref);
        if (table?.trim().startsWith("[")) {
          for (const m of table.matchAll(/"([a-zA-Z0-9-]+)"/g)) found.Ionicons.add(m[1]);
        }
      }
    }
  }
  return { Ionicons: [...found.Ionicons].sort(), Feather: [...found.Feather].sort() };
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
