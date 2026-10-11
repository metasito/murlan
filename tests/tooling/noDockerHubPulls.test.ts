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

const NAMED = /^[a-z][\w.-]*(?:\/[\w.-]+)*(?::[\w][\w.-]*)?(?:@sha256:[0-9a-f]+)?$/;
const DOCKER_LINE = /\bdocker\s+(.*)/;
const DOCKER_CALL = /(?:\bdocker\s*\(\s*|["'`]docker["'`]\s*,\s*)/g;
const MESSAGE = /\bnew\s+\w*Error\s*\(|\bconsole\.\w+\s*\(/;
const STRING = String.raw`"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|` + "`(?:[^`\\\\]|\\\\.)*`";
const ARRAY_ELEMENT = new RegExp(String.raw`\s*(${STRING}|[^,\]]+?)\s*([,\]])`, "y");
const YAML_IMAGE =
  /^\s*(?:-\s+)?(?:(?:image|container|[A-Z_]*_IMAGE):\s*["']?|uses:\s*["']?docker:\/\/)(\$\{\{.*?\}\}|[^\s"'#]+)/;
const IMAGE_VARIABLE = /^\s*([A-Z_]*_IMAGE):\s*["']?([^\s"'#]*)/gm;

// Flags that take a value are listed, not the valueless ones: an unlisted flag then names the wrong image and reds.
const RUN_VALUE_FLAGS = new Set([
  ..."acehlmpuvw".split("").map((letter) => `-${letter}`),
  ...[
    "add-host", "annotation", "attach", "blkio-weight", "blkio-weight-device", "cap-add", "cap-drop",
    "cgroup-parent", "cgroupns", "cidfile", "cpu-period", "cpu-quota", "cpu-rt-period", "cpu-rt-runtime",
    "cpu-shares", "cpus", "cpuset-cpus", "cpuset-mems", "detach-keys", "device", "device-cgroup-rule",
    "device-read-bps", "device-read-iops", "device-write-bps", "device-write-iops", "dns", "dns-option",
    "dns-search", "domainname", "entrypoint", "env", "env-file", "expose", "gpus", "group-add", "health-cmd",
    "health-interval", "health-retries", "health-start-interval", "health-start-period", "health-timeout",
    "hostname", "ip", "ip6", "ipc", "isolation", "kernel-memory", "label", "label-file", "link",
    "link-local-ip", "log-driver", "log-opt", "mac-address", "memory", "memory-reservation", "memory-swap",
    "memory-swappiness", "mount", "name", "network", "network-alias", "oom-score-adj", "pid", "pids-limit",
    "platform", "publish", "pull", "restart", "runtime", "security-opt", "shm-size", "stop-signal",
    "stop-timeout", "storage-opt", "sysctl", "tmpfs", "ulimit", "user", "userns", "uts", "volume",
    "volume-driver", "volumes-from", "workdir",
  ].map((name) => `--${name}`),
]);
const VALUE_FLAGS = new Map([
  ["run", RUN_VALUE_FLAGS],
  ["create", RUN_VALUE_FLAGS],
  ["pull", new Set(["--platform"])],
]);

const stripComments = (source: string) => source.replace(/^\s*(?:#|\/\/|\*|\/\*).*$/gm, "");

function takesValue(values: Set<string>, flag: string): boolean {
  if (flag.startsWith("--")) return !flag.includes("=") && values.has(flag);
  const letters = flag.slice(1);
  const first = [...letters].findIndex((letter) => values.has(`-${letter}`));
  return first === letters.length - 1;
}

function dockerImage(args: string[]): string | undefined {
  const [command, ...rest] = ["container", "image"].includes(args[0]) ? args.slice(1) : args;
  const values = VALUE_FLAGS.get(command);
  if (!values) return undefined;
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith("-")) return rest[i];
    if (takesValue(values, rest[i])) i++;
  }
  return undefined;
}

function declared(code: string, name: string): string[] | undefined {
  const at = new RegExp(String.raw`\b(?:const|let|var)\s+${name}\s*=\s*`).exec(code);
  if (!at) return undefined;
  const from = at.index + at[0].length;
  if (code[from] === "[") return arrayElements(code, from + 1);
  const literal = new RegExp(STRING, "y");
  literal.lastIndex = from;
  const value = literal.exec(code)?.[0];
  return value ? [value.slice(1, -1)] : undefined;
}

function arrayElements(code: string, from: number): string[] {
  const raw: string[] = [];
  ARRAY_ELEMENT.lastIndex = from;
  for (let m = ARRAY_ELEMENT.exec(code); m; m = m[2] === "]" ? null : ARRAY_ELEMENT.exec(code)) raw.push(m[1]);
  return raw.flatMap((element) => {
    if (/^["'`]/.test(element)) return [element.slice(1, -1)];
    const name = /^(?:\.\.\.)?(\w+)$/.exec(element)?.[1];
    return (name && declared(code, name)) || [element];
  });
}

function callArguments(code: string, from: number): string[] | undefined {
  if (code[from] === "[") return arrayElements(code, from + 1);
  const name = /\w+/y;
  name.lastIndex = from;
  const identifier = name.exec(code)?.[0];
  return identifier ? declared(code, identifier) : undefined;
}

export function imageRefs(file: string, source: string): string[] {
  const code = stripComments(source);
  const isScript = /\.m?[jt]s$/.test(file);
  const refs: string[] = [];
  if (/\.ya?ml$/.test(file)) {
    for (const line of code.split(/\r?\n/)) {
      const value = YAML_IMAGE.exec(line)?.[1];
      if (value && (NAMED.test(value) || value.startsWith("$"))) refs.push(value);
    }
  }
  for (const line of code.replace(/\\\r?\n/g, " ").split(/\r?\n/)) {
    if (isScript && MESSAGE.test(line)) continue;
    const args = DOCKER_LINE.exec(line)?.[1].trim().split(/\s+/).map((t) => t.replace(/^["'`]|["'`,;)]+$/g, ""));
    const image = args && dockerImage(args);
    if (image) refs.push(image);
  }
  if (isScript) {
    for (const call of code.matchAll(DOCKER_CALL)) {
      const args = callArguments(code, call.index + call[0].length);
      const image = args && dockerImage(args);
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
  const safe = new Set(
    yamlSources.flatMap((s) =>
      [...stripComments(s).matchAll(IMAGE_VARIABLE)]
        .filter(([, , value]) => NAMED.test(value) && !isDockerHub(value))
        .map(([, name]) => name),
    ),
  );
  return found
    .filter(({ ref }) => {
      const variable = /^\$\{?(\w+)\}?$|^\$\{\{\s*env\.(\w+)\s*\}\}$/.exec(ref);
      return variable ? !safe.has(variable[1] ?? variable[2]) : isDockerHub(ref);
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
    assert.deepEqual(imageRefs("s.sh", "docker run -dit alpine:3 sh\n"), ["alpine:3"]);
    assert.deepEqual(imageRefs("s.sh", "docker run --no-healthcheck -de A=1 -p5432:5432 -eB postgres:16 x\n"), [
      "postgres:16",
    ]);
    assert.deepEqual(imageRefs("s.sh", "docker run --health-cmd pg_isready postgres:16\n"), ["postgres:16"]);
    assert.deepEqual(imageRefs("s.sh", "docker container run --rm postgres:16\ndocker image pull redis\n"), [
      "postgres:16",
      "redis",
    ]);
    assert.deepEqual(imageRefs("s.mjs", 'docker(["container", "run", "-dit", "postgres:16"]);\n'), ["postgres:16"]);
    assert.deepEqual(imageRefs("s.mjs", 'execSync("docker run --rm postgres psql");\n'), ["postgres"]);
    assert.deepEqual(imageRefs("s.mjs", 'const args = ["run", ...flags, "postgres:16"];\nspawnSync("docker", args);\n'), [
      "...flags",
    ]);
    assert.deepEqual(
      imageRefs("s.mjs", 'const flags = ["-d"];\nconst IMAGE = "ghcr.io/a/b:1";\ndocker(["run", ...flags, IMAGE]);\n'),
      ["ghcr.io/a/b:1"],
    );
    assert.deepEqual(imageRefs("w.yml", "        image: ${{ matrix.pg }}\n"), ["${{ matrix.pg }}"]);
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
    assert.deepEqual(hubPulls(pull, ["env:\n  X_IMAGE: ${{ vars.X }}\n"]), ["s.sh: $X_IMAGE"]);
    assert.deepEqual(hubPulls(pull, ["env:\n  X_IMAGE: postgres:16\n"]), ["s.sh: $X_IMAGE"]);
    assert.deepEqual(hubPulls([{ file: "w.yml", ref: "${{ env.X_IMAGE }}" }], ['  X_IMAGE: "ghcr.io/a/b:1"\n']), []);
    assert.deepEqual(hubPulls([{ file: "w.yml", ref: "${{ matrix.pg }}" }], []), ["w.yml: ${{ matrix.pg }}"]);
  });

  test("none of them is on Docker Hub", () => {
    const yaml = scannedFiles().filter((f) => /\.ya?ml$/.test(f)).map(read);
    assert.deepEqual(hubPulls(found, yaml), [], "pull from public.ecr.aws/docker/library or ghcr.io instead");
  });
});
