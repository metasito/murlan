import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (file: string) => readFileSync(path.join(repoRoot, file), "utf8");
const list = (dir: string, keep: (name: string) => boolean) =>
  readdirSync(path.join(repoRoot, dir))
    .filter(keep)
    .map((name) => `${dir}/${name}`);

function scannedFiles(): string[] {
  const actions = readdirSync(path.join(repoRoot, ".github/actions"))
    .map((action) => `.github/actions/${action}/action.yml`)
    .filter((file) => existsSync(path.join(repoRoot, file)));
  return [
    ...list(".github/workflows", (n) => /\.ya?ml$/.test(n)),
    ...actions,
    ...list(".github/scripts", () => true),
    ...list("scripts", (n) => /\.(mjs|sh)$/.test(n)),
  ];
}

const IMAGE = /^[a-z][\w.-]*(?:\/[\w.-]+)*:[\w][\w.-]*$/;
const DOCKER_PULLS = /\bdocker\s+(?:run|pull|create)\b/;
const YAML_IMAGE = /^\s*(?:-\s+)?(?:image|container|[A-Z_]*_IMAGE):\s*["']?([^\s"'#]+)/;

const stripComments = (source: string) => source.replace(/^\s*(?:#|\/\/|\*|\/\*).*$/gm, "");

export function imageRefs(file: string, source: string): string[] {
  const code = stripComments(source);
  const refs: string[] = [];
  if (/\.ya?ml$/.test(file)) {
    for (const line of code.split(/\r?\n/)) {
      const value = YAML_IMAGE.exec(line)?.[1];
      if (value && IMAGE.test(value)) refs.push(value);
    }
  }
  for (const line of code.split(/\r?\n/).filter((l) => DOCKER_PULLS.test(l))) {
    for (const token of line.split(/\s+/)) {
      const bare = token.replace(/^["'`]|["'`,]$/g, "");
      if (IMAGE.test(bare) && !refs.includes(bare)) refs.push(bare);
    }
  }
  if (/\.m?[jt]s$/.test(file) && /\bdocker\b/.test(code)) {
    for (const [, literal] of code.matchAll(/["'`]([^"'`\s]+)["'`]/g)) {
      if (IMAGE.test(literal) && !literal.startsWith("node:") && !refs.includes(literal)) {
        refs.push(literal);
      }
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
    assert.deepEqual(imageRefs("w.yml", 'env:\n  SCAN_IMAGE: "a/b:1"\n'), ["a/b:1"]);
    assert.deepEqual(imageRefs("w.yml", "      - run: docker pull redis:7 -q\n"), ["redis:7"]);
    assert.deepEqual(imageRefs("s.sh", 'docker run --rm -p 5432:5432 -v "$d:/r" mysql:8 x\n'), ["mysql:8"]);
    assert.deepEqual(
      imageRefs("s.mjs", 'import "node:fs";\ndocker(["run", "-d",\n  "-p", `${p}:5432`,\n  "postgres:16-alpine",\n]);\n'),
      ["postgres:16-alpine"],
    );
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

  test("none of them is on Docker Hub", () => {
    const hub = found.filter(({ ref }) => isDockerHub(ref)).map(({ file, ref }) => `${file}: ${ref}`);
    assert.deepEqual(hub, [], "pull from public.ecr.aws/docker/library or ghcr.io instead");
  });
});
