// Asks production's /health once. Exit 0 only for a 200 from a configured URL.
const PROBE_TIMEOUT_MS = 30_000;

const base = process.env.PROD_URL;
if (!base) {
  console.error("PROD_URL is not set: set the PROD_URL repository variable to production's origin");
  process.exit(1);
}
try {
  const res = await fetch(new URL("/health", base), { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  console.log(`${base}/health answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  process.exit(res.status === 200 ? 0 : 1);
} catch (err) {
  console.error(`${base}/health did not answer: ${String(err)}`);
  process.exit(1);
}
