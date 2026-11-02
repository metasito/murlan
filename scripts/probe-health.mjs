// Asks production's /health once. Exit 0 only for a 200 from a configured URL whose body says the
// instance and both its dependencies are up: /health answers 200 with a dependency down, by design.
const PROBE_TIMEOUT_MS = 30_000;

const base = process.env.PROD_URL;
if (!base) {
  console.error("PROD_URL is not set: set the PROD_URL repository variable to production's origin");
  process.exit(1);
}

function healthy(text) {
  try {
    const body = JSON.parse(text);
    return body.status === "ok" && body.db === "connected" && body.redis === "connected";
  } catch {
    return false;
  }
}

try {
  const res = await fetch(new URL("/health", base), { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  const text = await res.text();
  console.log(`${base}/health answered ${res.status}: ${text.slice(0, 200)}`);
  process.exit(res.status === 200 && healthy(text) ? 0 : 1);
} catch (err) {
  console.error(`${base}/health did not answer: ${String(err)}`);
  process.exit(1);
}
