#!/usr/bin/env node
// Reports asset sizes under assets/ and installed sizes of production
// dependencies under node_modules/, both sorted largest-first.
//
// Plain Node, no dependencies. Run with: node scripts/bundle-report.mjs
// Pipe to docs/BUNDLE.md to refresh the committed snapshot:
//   node scripts/bundle-report.mjs > docs/BUNDLE.md

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/** Recursively sum file sizes under `dir`. Skips symlinks to avoid cycles. */
function dirSize(dir) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      total += dirSize(full);
    } else if (entry.isFile()) {
      total += fs.statSync(full).size;
    }
  }
  return total;
}

/** List every file under `dir` (relative paths) with its size, recursively. */
function listFiles(dir, base = dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      out.push(...listFiles(full, base));
    } else if (entry.isFile()) {
      out.push({
        relPath: path.relative(base, full).split(path.sep).join("/"),
        size: fs.statSync(full).size,
      });
    }
  }
  return out;
}

/** Sort largest-first, tie-broken by ascending name so output is deterministic. */
function sortLargestFirst(items, nameKey) {
  return [...items].sort((a, b) => {
    if (b.size !== a.size) return b.size - a.size;
    return a[nameKey] < b[nameKey] ? -1 : a[nameKey] > b[nameKey] ? 1 : 0;
  });
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function buildAssetReport() {
  const assetsDir = path.join(ROOT, "assets");
  const files = listFiles(assetsDir);
  const sorted = sortLargestFirst(files, "relPath");
  const total = files.reduce((sum, f) => sum + f.size, 0);
  return { total, files: sorted };
}

function buildDependencyReport() {
  const pkgPath = path.join(ROOT, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const deps = Object.keys(pkg.dependencies || {});
  const rows = deps.map((name) => {
    const dir = path.join(ROOT, "node_modules", ...name.split("/"));
    const size = fs.existsSync(dir) ? dirSize(dir) : 0;
    return { name, size, installed: fs.existsSync(dir) };
  });
  const sorted = sortLargestFirst(rows, "name");
  const total = rows.reduce((sum, r) => sum + r.size, 0);
  return { total, rows: sorted };
}

function renderMarkdown({ assets, deps }) {
  const lines = [];
  lines.push("# Bundle size report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString().slice(0, 10)}`);
  lines.push("");
  lines.push(
    "Regenerate with `node scripts/bundle-report.mjs > docs/BUNDLE.md` " +
      "after adding/removing assets or dependencies."
  );
  lines.push("");
  lines.push("## Assets (`assets/`)");
  lines.push("");
  lines.push(`Total: **${formatBytes(assets.total)}** across ${assets.files.length} files.`);
  lines.push("");
  lines.push("| File | Size |");
  lines.push("|---|---|");
  for (const f of assets.files) {
    lines.push(`| assets/${f.relPath} | ${formatBytes(f.size)} |`);
  }
  lines.push("");
  lines.push("## Production dependencies (installed size in `node_modules/`)");
  lines.push("");
  lines.push(
    `Total: **${formatBytes(deps.total)}** across ${deps.rows.length} declared dependencies.`
  );
  lines.push("");
  lines.push("| Package | Installed size |");
  lines.push("|---|---|");
  for (const r of deps.rows) {
    const label = r.installed ? formatBytes(r.size) : "not installed";
    lines.push(`| ${r.name} | ${label} |`);
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push(
    "- `node_modules/` installed size is not the same as what Metro ships to the " +
      "device, but Metro does not tree-shake assets. A module that is reached at " +
      "all contributes every asset it requires, so the root module of " +
      "`@expo/vector-icons` (one `.ttf` per icon family) or of an " +
      "`@expo-google-fonts/*` package (one `.ttf` per weight and italic) ships " +
      "the whole package. Both are therefore imported by subpath — " +
      "`@expo/vector-icons/Ionicons`, `@expo-google-fonts/inter/400Regular` — " +
      "which `tests/assetBarrels.test.ts` pins."
  );
  lines.push(
    "- `assets/images/icon.png` and `assets/images/splash-icon.png` dominate the " +
      "assets total. Both are required, referenced by `app.json`'s `icon` and the " +
      "`expo-splash-screen` plugin config. What can and cannot be recovered from " +
      "them is measured in issue #31 — this report states sizes, not " +
      "conclusions about them."
  );
  lines.push(
    "- `assets/images/android-icon-monochrome.png` is 432x432 while the other " +
      "adaptive-icon layers (`android-icon-foreground.png`, " +
      "`android-icon-background.png`) are 512x512. This is a visual-consistency " +
      "mismatch, not a size problem (it is already the smallest icon file). " +
      "Left as-is; flagged for design follow-up outside this report's scope."
  );
  lines.push("");
  return lines.join("\n");
}

function main() {
  const assets = buildAssetReport();
  const deps = buildDependencyReport();
  process.stdout.write(renderMarkdown({ assets, deps }));
}

main();
