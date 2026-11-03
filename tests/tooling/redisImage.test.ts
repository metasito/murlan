import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { trackedFiles } from "../helpers/trackedFiles.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (file: string) => readFileSync(path.join(repoRoot, file), "utf8");

/** Any key-value image, Redis's or Valkey's, so a Redis left behind is a mismatch rather than unseen. */
const STORE_REFS = [
  /(?:[\w.-]+\/)*(?:redis|valkey):[A-Za-z0-9][\w.-]*(?:@sha256:[0-9a-f]{64})?/g,
  /(?<=\bimage:\s*["']?|\bdocker (?:pull|run)\b[^\n]*\s)(?:[\w.-]+\/)*(?:redis|valkey)(?:@sha256:[0-9a-f]{64})?(?=["']?\s*$|\s)/gm,
];
const SERVICE = /\n      valkey:\n        image: [^\n]+\n(?:        [^\n]*\n)*?          --health-cmd "valkey-cli ping"\n/g;
const WHERE = [
  [".github/workflows/ci.yml", 2, "the Valkey services of verify and build"],
  [".github/workflows/soak.yml", 1, "its Valkey service"],
  [".github/workflows/mutation.yml", 1, "its Valkey service"],
  ["scripts/dev-stack.mjs", 1, "the Valkey it runs"],
] as const;

type Ref = { file: string; ref: string };

const refsIn = (file: string, src: string): Ref[] =>
  STORE_REFS.flatMap((pattern) => [...src.matchAll(pattern)].map(([ref]) => ({ file, ref })));

/** Every way the refs fall short of one pinned image at the manifest's major. */
function problems(refs: Ref[], image: string | undefined, major: number): string[] {
  if (!image) return ["scripts/dev-stack.mjs names no VALKEY_IMAGE"];
  const found = WHERE.flatMap(([file, min, what]) =>
    refs.filter((r) => r.file === file).length >= min ? [] : [`${file}: ${what} not found`]
  );
  found.push(...refs.filter((r) => r.ref !== image).map((r) => `${r.file}: ${r.ref} is not ${image}`));
  if (!/^mirror\.gcr\.io\/valkey\/valkey:[\w.-]+@sha256:[0-9a-f]{64}$/.test(image)) {
    found.push(`${image}: not the mirror's Valkey pinned by digest; a tag can be repointed`);
  }
  if (Number(/valkey:(\d+)/.exec(image)?.[1]) !== major) found.push(`${image}: not deploy/runtime.json's major ${major}`);
  return found;
}

function repoRefs(): { refs: Ref[]; image: string | undefined; major: number } {
  const image = /^const VALKEY_IMAGE = "([^"]+)";$/m.exec(read("scripts/dev-stack.mjs"))?.[1];
  const refs = trackedFiles(repoRoot, ".github", "scripts")
    .filter((f) => /\.(ya?ml|sh|mjs|js|ts)$/.test(f))
    .flatMap((file) => refsIn(file, read(file)));
  return { refs, image, major: JSON.parse(read("deploy/runtime.json")).keyValue.major };
}

// A workflow's `services:` image cannot read a variable, so each one repeats dev-stack.mjs's
// VALKEY_IMAGE and this holds them to it.
test("every key-value image is dev-stack.mjs's VALKEY_IMAGE, pinned, at the manifest's major", () => {
  const { refs, image, major } = repoRefs();
  assert.deepEqual(problems(refs, image, major), []);
});

test("the image check fails on a Redis left behind, on another major, and on finding nothing", () => {
  const { refs, image, major } = repoRefs();
  const planted = refsIn(".github/workflows/soak.yml", "        image: mirror.gcr.io/library/redis:7-alpine@sha256:" + "a".repeat(64));
  assert.match(problems([...refs, ...planted], image, major).join("\n"), /redis:7-alpine/);
  assert.notDeepEqual(problems(refs, image, major + 1), []);
  assert.notDeepEqual(problems([], image, major), []);
  assert.notDeepEqual(problems(refs, undefined, major), []);
  assert.notDeepEqual(problems(refs, image?.replace(/@sha256:.*/, ""), major), []);
});

test("a ref is seen at any tag or none, and nothing that only names Redis is taken for one", () => {
  for (const planted of [
    "        image: valkey/valkey:latest\n",
    "        image: redis:alpine\n",
    "        image: redis\n",
    '        image: "mirror.gcr.io/valkey/valkey"\n',
    "      - run: docker pull redis\n",
    "      - run: docker run --rm -p 6379:6379 valkey/valkey -q\n",
  ]) {
    assert.equal(refsIn("w.yml", planted).length, 1, `missed or doubled: ${planted.trim()}`);
  }
  assert.deepEqual(
    refsIn("w.yml", '      REDIS_URL: redis://localhost:6379/0\n          --health-cmd "valkey-cli ping"\n      valkey:\n'),
    []
  );
  assert.deepEqual(refsIn("d.mjs", 'docker(["run", "-d", "--name", "murlan-dev-redis", "-p", p]);'), []);
});

test("every workflow's Valkey service waits for a PING before the job starts", () => {
  for (const [file, services] of [[".github/workflows/ci.yml", 2], [".github/workflows/soak.yml", 1], [".github/workflows/mutation.yml", 1]] as const) {
    const src = read(file);
    assert.equal(src.match(SERVICE)?.length ?? 0, services, `${file}: a Valkey service without its health command`);
    assert.match(src, /\n      REDIS_URL: redis:\/\/localhost:6379\/\d+\n/, `${file}: the jobs are not handed REDIS_URL`);
  }
});
