import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (file: string) => readFileSync(path.join(repoRoot, file), "utf8");
function walk(dir: string, keep: (file: string) => boolean): string[] {
  return readdirSync(path.join(repoRoot, dir), { withFileTypes: true }).flatMap((entry) => {
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === "tests" ? [] : walk(file, keep);
    return keep(file) ? [file] : [];
  });
}

function scannedFiles(): string[] {
  return [
    ...walk(".github", (f) => /\.(ya?ml|sh|mjs|js|ts)$/.test(f)),
    ...walk("scripts", (f) => /\.(mjs|sh|ts)$/.test(f)),
    ...walk("tools", (f) => /\.(mjs|sh|ts)$/.test(f)),
  ];
}

const TAGGED = /^[a-z][\w.-]*(?:\/[\w.-]+)*(?::[\w][\w.-]*|@sha256:[0-9a-f]+)$/;
const NAMED = /^[a-z][\w.-]*(?:\/[\w.-]+)*(?::[\w][\w.-]*)?(?:@sha256:[0-9a-f]+)?$/;
const DOCKER_PULLS = /\bdocker\s+(?:run|pull|create)\b(.*)/;
const DOCKER_ARRAY = /(?:\bdocker\s*\(\s*|["'`]docker["'`]\s*,\s*)\[\s*(["'`])(?:run|pull|create)\1\s*,/g;
const ARRAY_ELEMENT = /\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|[^,\]]+?)\s*([,\]])/y;
const YAML_IMAGE =
  /^\s*(?:-\s+)?(?:(?:image|container|[A-Z_]*_IMAGE):\s*["']?|uses:\s*["']?docker:\/\/)([^\s"'#]+)/;
const VALUELESS_FLAGS = new Set([
  "-d", "--detach", "--rm", "-i", "-t", "-it", "-ti", "--interactive", "--tty", "--init", "--privileged",
  "-P", "--publish-all", "--read-only", "-q", "--quiet", "-a", "--all-tags", "--disable-content-trust",
]);

const stripComments = (source: string) => source.replace(/^\s*(?:#|\/\/|\*|\/\*).*$/gm, "");

function imageArgument(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("-")) return args[i];
    if (!args[i].includes("=") && !VALUELESS_FLAGS.has(args[i])) i++;
  }
  return undefined;
}

function arrayElements(code: string, from: number): string[] {
  const elements: string[] = [];
  ARRAY_ELEMENT.lastIndex = from;
  for (let m = ARRAY_ELEMENT.exec(code); m; m = m[2] === "]" ? null : ARRAY_ELEMENT.exec(code)) {
    elements.push(/^["'`]/.test(m[1]) ? m[1].slice(1, -1) : m[1]);
  }
  return elements;
}

export function imageRefs(file: string, source: string): string[] {
  const code = stripComments(source);
  const isScript = /\.m?[jt]s$/.test(file);
  const refs: string[] = [];
  if (/\.ya?ml$/.test(file)) {
    for (const line of code.split(/\r?\n/)) {
      const value = YAML_IMAGE.exec(line)?.[1];
      if (value && NAMED.test(value)) refs.push(value);
    }
  }
  for (const line of code.replace(/\\\r?\n/g, " ").split(/\r?\n/)) {
    const args = DOCKER_PULLS.exec(line)?.[1].trim().split(/\s+/).map((t) => t.replace(/^["'`]|["'`,;)]+$/g, ""));
    const image = args && imageArgument(args);
    if (image && (!isScript || TAGGED.test(image))) refs.push(image);
  }
  if (isScript) {
    for (const call of code.matchAll(DOCKER_ARRAY)) {
      const image = imageArgument(arrayElements(code, call.index + call[0].length));
      if (image) refs.push(image);
    }
  }
  return refs;
}

const DOCKER_HUB_HOSTS = new Set(["docker.io", "index.docker.io", "registry-1.docker.io"]);

export function isDockerHub(ref: string): boolean {
  const [first, ...rest] = ref.split("/");
  const isHost = rest.length > 0 && (/[.:]/.test(first) || first === "localhost");
  return !isHost || DOCKER_HUB_HOSTS.has(first);
}

export function hubPulls(found: { file: string; ref: string }[], yamlSources: string[]): string[] {
  const defined = new Set(
    yamlSources.flatMap((s) => [...stripComments(s).matchAll(/^\s*([A-Z_]*_IMAGE):/gm)].map((m) => m[1])),
  );
  return found
    .filter(({ ref }) => {
      const variable = /^\$\{?(\w+)\}?$/.exec(ref)?.[1];
      return variable ? !defined.has(variable) : isDockerHub(ref);
    })
    .map(({ file, ref }) => `${file}: ${ref}`);
}

describe("no CI job pulls an image from Docker Hub", () => {
  test("a bare or docker.io name is Docker Hub; a registry host is not", () => {
    for (const ref of ["postgres:16-alpine", "zricethezav/gitleaks:v8.30.1", "docker.io/library/redis:7"]) {
      assert.equal(isDockerHub(ref), true, ref);
    }
    for (const ref of ["public.ecr.aws/docker/library/postgres:16-alpine", "ghcr.io/gitleaks/gitleaks:v8.30.1"]) {
      assert.equal(isDockerHub(ref), false, ref);
    }
  });

  test("every place an image can be named is read", () => {
    assert.deepEqual(imageRefs("w.yml", "    services:\n      pg:\n        image: postgres:16\n"), ["postgres:16"]);
    assert.deepEqual(imageRefs("w.yml", "    container: node:24\n"), ["node:24"]);
    assert.deepEqual(imageRefs("w.yml", "        image: postgres\n"), ["postgres"]);
    assert.deepEqual(imageRefs("w.yml", "        image: postgres@sha256:ab12\n"), ["postgres@sha256:ab12"]);
    assert.deepEqual(imageRefs("w.yml", "      - uses: docker://alpine:3\n"), ["alpine:3"]);
    assert.deepEqual(imageRefs("w.yml", "    container:\n      image: node:24\n"), ["node:24"]);
    assert.deepEqual(imageRefs("w.yml", 'env:\n  SCAN_IMAGE: "a/b:1"\n'), ["a/b:1"]);
    assert.deepEqual(imageRefs("w.yml", "      - run: docker pull redis:7 -q\n"), ["redis:7"]);
    assert.deepEqual(imageRefs("s.sh", 'docker run --rm -p 5432:5432 -v "$d:/r" mysql:8 x\n'), ["mysql:8"]);
    assert.deepEqual(
      imageRefs("s.mjs", 'import "node:fs";\ndocker(["run", "-d",\n  "-p", `${p}:5432`,\n  "postgres:16-alpine",\n]);\n'),
      ["postgres:16-alpine"],
    );
    assert.deepEqual(imageRefs("s.mjs", 'spawnSync("docker", ["run", "--rm", "node:22-alpine", "node", "-v"]);\n'), [
      "node:22-alpine",
    ]);
    assert.deepEqual(imageRefs("s.mjs", 'docker(["run",\n  "postgres",\n]);\n'), ["postgres"]);
    assert.deepEqual(imageRefs("s.mjs", 'docker(["pull", "-q", IMAGE]);\n'), ["IMAGE"]);
    assert.deepEqual(imageRefs("s.sh", "docker run --rm -e A=1 postgres psql\n"), ["postgres"]);
    assert.deepEqual(imageRefs("s.sh", 'docker run -v "$d:/r" "$X_IMAGE" \\\n  detect\n'), ["$X_IMAGE"]);
    assert.deepEqual(imageRefs("w.yml", "      - run: |\n          docker run --rm \\\n            alpine:3 sh\n"), ["alpine:3"]);
    assert.deepEqual(imageRefs("s.mjs", 'docker(["ps"]);\nconst u = "localhost:5432";\n'), []);
    assert.deepEqual(imageRefs("s.mjs", 'throw new Error(`docker run failed on port ${port}`);\n'), []);
    assert.deepEqual(imageRefs("s.mjs", 'import "node:fs";\n// docker run "postgres:16"\n'), []);
    assert.deepEqual(imageRefs("w.yml", "  # image: postgres:16\n"), []);
  });

  const found = scannedFiles().flatMap((file) =>
    imageRefs(file, read(file)).map((ref) => ({ file, ref })),
  );

  test("the scan finds the images CI actually pulls", () => {
    const count = (file: string) => found.filter((f) => f.file === file).length;
    assert.ok(count(".github/workflows/ci.yml") >= 3, "ci.yml: the two Postgres services and the gitleaks image");
    assert.ok(count(".github/workflows/soak.yml") >= 1, "soak.yml: its Postgres service");
    assert.ok(count("scripts/dev-stack.mjs") >= 1, "dev-stack.mjs: the Postgres it runs");
  });

  test("an image variable counts only where a workflow sets it", () => {
    const pull = [{ file: "s.sh", ref: "$X_IMAGE" }];
    assert.deepEqual(hubPulls(pull, []), ["s.sh: $X_IMAGE"]);
    assert.deepEqual(hubPulls(pull, ["env:\n  X_IMAGE: ghcr.io/a/b:1\n"]), []);
    assert.deepEqual(hubPulls(pull, ["env:\n  # X_IMAGE: ghcr.io/a/b:1\n"]), ["s.sh: $X_IMAGE"]);
  });

  test("none of them is on Docker Hub", () => {
    const yaml = scannedFiles().filter((f) => /\.ya?ml$/.test(f)).map(read);
    assert.deepEqual(hubPulls(found, yaml), [], "pull from public.ecr.aws/docker/library or ghcr.io instead");
  });
});
