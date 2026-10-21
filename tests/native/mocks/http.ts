export type HttpRequest = { method: string; path: string; url: string; body: unknown };
export type HttpReply = { status?: number; body?: unknown };
type Answer = HttpReply | ((request: HttpRequest) => HttpReply | Promise<HttpReply>);

type HttpState = { routes: Map<string, Answer>; requests: HttpRequest[] };

function state(): HttpState {
  const g = globalThis as { __fakeHttp?: HttpState };
  g.__fakeHttp ??= { routes: new Map(), requests: [] };
  return g.__fakeHttp;
}

const key = (method: string, path: string) => `${method.toUpperCase()} ${path}`;

/** Answers `method path` (the path without query or origin) until the next test. */
export function route(method: string, path: string, answer: Answer): void {
  state().routes.set(key(method, path), answer);
}

/** An answer that never arrives: the request rejects as it does with no network. */
export const unreachable: Answer = () => {
  throw new TypeError('Network request failed');
};

/** Every request `fetch` was asked, routed or not, in order. */
export function httpRequests(): readonly HttpRequest[] {
  return state().requests;
}

/** Run by setup.ts before every test. */
export function resetHttp(): void {
  state().routes.clear();
  state().requests.length = 0;
}

function parseBody(body: unknown): unknown {
  if (typeof body !== 'string') return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function response(status: number, body: unknown) {
  const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  const make = () => ({
    status,
    ok: status >= 200 && status < 300,
    statusText: String(status),
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => JSON.parse(text),
    text: async () => text,
    clone: make,
  });
  return make();
}

/** The app's `fetch`. A request no test routed rejects as React Native's fetch does with no network. */
export async function fakeFetch(input: unknown, init: { method?: string; body?: unknown } = {}) {
  const url = typeof input === 'string' ? input : String((input as { url?: string }).url ?? input);
  const method = (init.method ?? 'GET').toUpperCase();
  const request: HttpRequest = { method, url, path: new URL(url, 'http://localhost').pathname, body: parseBody(init.body) };
  state().requests.push(request);
  const answer = state().routes.get(key(method, request.path));
  if (!answer) throw new TypeError('Network request failed');
  const reply = typeof answer === 'function' ? await answer(request) : answer;
  return response(reply.status ?? 200, reply.body);
}
