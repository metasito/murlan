import { test, mock } from "node:test";
import assert from "node:assert/strict";

type Body = { seq: number; rows: { k: string }[]; dropped: number };

async function withFetch(answers: (n: number) => "ok" | "fail" | "hang", body: (sent: Body[], recorder: typeof import("../../lib/diagnostics/recorder.ts").recorder) => Promise<void>, address = true) {
  const sent: Body[] = [];
  const realFetch = globalThis.fetch;
  let n = 0;
  globalThis.fetch = (async (_url: string, init: { body: string; signal: AbortSignal }) => {
    const answer = answers(n++);
    if (answer === "hang") return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    if (answer === "fail") throw new Error("offline");
    sent.push(JSON.parse(init.body));
    return new Response("ok");
  }) as unknown as typeof fetch;
  try {
    const { recorder } = await import(`../../lib/diagnostics/recorder.ts?${Math.random()}`);
    if (address) recorder.postTo("10.0.0.7");
    await body(sent, recorder);
  } finally {
    globalThis.fetch = realFetch;
  }
}

const row = (t: number) => ({ k: "frame", t, dt: 8 }) as never;
const tick = () => new Promise((r) => setTimeout(r, 5));

test("a batch the PC refused is sent again with the same seq, and rows after it wait their turn", async () => {
  await withFetch((n) => (n === 0 ? "fail" : "ok"), async (sent, recorder) => {
    recorder.push(row(1));
    recorder.flush();
    await tick();
    recorder.push(row(2));
    recorder.flush();
    await tick();
    recorder.flush();
    await tick();
    assert.deepEqual(sent.map((b) => b.seq), [0, 1]);
    assert.equal(sent[0].rows.length, 1);
  });
});

test("a held recorder sends nothing on its tick until it is released, then sends what the window left", async () => {
  mock.timers.enable({ apis: ["setInterval", "Date"] });
  try {
    await withFetch(() => "ok", async (sent, recorder) => {
      recorder.hold(true);
      recorder.push(row(1));
      mock.timers.tick(1000);
      await tick();
      assert.equal(sent.length, 0);
      recorder.hold(false);
      await tick();
      assert.equal(sent.length, 1);
    });
  } finally {
    mock.timers.reset();
  }
});

test("rows pushed before the PC's address is known are not kept", async () => {
  await withFetch(() => "ok", async (sent, recorder) => {
    recorder.push(row(1));
    recorder.postTo("10.0.0.7");
    recorder.flush();
    await tick();
    assert.equal(sent.length, 0);
  }, false);
});

test("a backlog drains within one pass once the PC answers again", async () => {
  await withFetch((n) => (n < 3 ? "fail" : "ok"), async (sent, recorder) => {
    for (let i = 0; i < 3; i++) {
      recorder.push(row(i));
      recorder.flush();
      await tick();
    }
    recorder.flush();
    await tick();
    assert.deepEqual(sent.map((b) => b.seq), [0, 1, 2]);
  });
});

test("past the cap the oldest rows are given up and the next batch says how many", async () => {
  await withFetch(() => "ok", async (sent, recorder) => {
    for (let i = 0; i < 5001; i++) recorder.push(row(i));
    recorder.flush();
    await tick();
    assert.equal(sent[0].dropped, 2500);
    assert.equal(sent[0].rows.length, 2501);
  });
});
