/**
 * These deadlines exist to fail a hung test loudly rather than stall the
 * suite; none of them asserts how fast the server is. A shared runner is
 * several times slower than a developer machine — the integration suite takes
 * 134s locally and 238s on CI — and the socket tests deliberately saturate the
 * connect path, so a budget chosen against local latency fails on load while
 * nothing is wrong. Every deadline scales instead of each one being retuned.
 *
 * Its own module rather than a socket helper's export, so the browser suite
 * can scale by the same figure without pulling socket.io-client in.
 */
export const DEADLINE_SCALE = process.env.CI ? 4 : 1;
