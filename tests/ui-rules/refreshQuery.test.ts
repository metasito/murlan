// tests/ui-rules/refreshQuery.test.ts — a write that lands while a list is still
// loading for the first time reaches the screen.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { QueryClient, QueryObserver } from "@tanstack/query-core";
import { refreshQuery } from "../../lib/refreshQuery.ts";
import { scanSources, sourcesUnder } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RAW_INVALIDATE = /\.(invalidateQueries|refetchQueries)\(/g;

/** A first load held open until `release`, then every later fetch answering at once. */
function firstLoadInFlight() {
  let release!: (v: string) => void;
  const first = new Promise<string>((r) => (release = r));
  let calls = 0;
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const observer = new QueryObserver(qc, {
    queryKey: ["/api/friends"],
    queryFn: () => (++calls === 1 ? first : Promise.resolve("after the write")),
  });
  const unsubscribe = observer.subscribe(() => {});
  return { qc, observer, release, calls: () => calls, unsubscribe };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("refreshQuery", () => {
  test("a plain invalidate during a first load keeps the answer read before the write", async () => {
    const t = firstLoadInFlight();
    await settle();
    void t.qc.invalidateQueries({ queryKey: ["/api/friends"] });
    t.release("before the write");
    await settle();
    assert.equal(t.calls(), 1);
    assert.equal(t.observer.getCurrentResult().data, "before the write");
    t.unsubscribe();
  });

  test("refreshQuery during a first load refetches, so the write shows", async () => {
    const t = firstLoadInFlight();
    await settle();
    assert.equal(t.observer.getCurrentResult().fetchStatus, "fetching");
    const done = refreshQuery(t.qc, ["/api/friends"]);
    t.release("before the write");
    await done;
    await settle();
    assert.equal(t.calls(), 2);
    assert.equal(t.observer.getCurrentResult().data, "after the write");
    t.unsubscribe();
  });

  test("refreshQuery on a loaded list refetches once", async () => {
    const t = firstLoadInFlight();
    t.release("before the write");
    await settle();
    await refreshQuery(t.qc, ["/api/friends"]);
    assert.equal(t.calls(), 2);
    assert.equal(t.observer.getCurrentResult().data, "after the write");
    t.unsubscribe();
  });

  test("the client invalidates only through refreshQuery", () => {
    const sources = sourcesUnder(repoRoot, ["app", "components", "context", "lib"]).filter(
      ([file]) => file !== "lib/refreshQuery.ts"
    );
    assert.deepEqual(scanSources(RAW_INVALIDATE, sources), []);
  });

  test("the scan sees a planted raw invalidate", () => {
    const planted: [string, string][] = [["app/x.tsx", `qc.invalidateQueries({ queryKey: ["/a"] });`]];
    assert.deepEqual(scanSources(RAW_INVALIDATE, planted), ["app/x.tsx: .invalidateQueries("]);
  });
});
