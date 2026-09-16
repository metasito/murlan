import path from "node:path";

/** Contract: one `test files run in <dir>: <n>` line per directory, which ci.yml's Test guard counts. */
export default async function* filesRun(source) {
  const files = new Set();
  for await (const { type, data } of source) {
    if ((type === "test:pass" || type === "test:fail") && data.file) files.add(data.file);
  }
  const perDir = new Map();
  for (const file of files) {
    const dir = path.relative(process.cwd(), path.dirname(file)).split(path.sep).join("/");
    perDir.set(dir, (perDir.get(dir) ?? 0) + 1);
  }
  for (const [dir, count] of [...perDir].sort()) yield `test files run in ${dir}: ${count}\n`;
}
