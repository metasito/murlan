import { describe, it, expect } from '@jest/globals';
import { api } from '@/lib/query-client';
import { ApiError } from '@/lib/apiError';
import { queryKey } from '@/lib/queries';
import { httpRequests, route, unreachable } from './mocks/http';

process.env.EXPO_PUBLIC_DOMAIN ??= 'murlan.test';

describe('api()', () => {
  it('answers a 204 with undefined, having sent the body as JSON', async () => {
    route('POST', '/api/client-errors', { status: 204 });
    await expect(api('POST client-errors', { body: { message: 'boom' } })).resolves.toBeUndefined();
    expect(httpRequests().map((r) => [r.method, r.path, r.body])).toEqual([
      ['POST', '/api/client-errors', { message: 'boom' }],
    ]);
  });

  it('answers a reply-less route with undefined in its type too', async () => {
    route('POST', '/api/client-errors', { status: 204 });
    const reply: Promise<undefined> = api('POST client-errors', { body: { message: 'boom' } });
    await expect(reply).resolves.toBeUndefined();
  });

  it('sends a route whose body is optional as a whole with no input at all', async () => {
    route('POST', '/api/auth/resend-verification', { body: { ok: true } });
    await expect(api('POST auth/resend-verification')).resolves.toEqual({ ok: true });
    expect(httpRequests().map((r) => r.body)).toEqual([undefined]);
  });

  it('rejects a 2xx whose body is not JSON with an ApiError carrying the text', async () => {
    route('POST', '/api/friends/add', { body: '<html>proxy</html>' });
    const refused = await api('POST friends/add', { body: { username: 'ana' } }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ApiError);
    expect((refused as ApiError).status).toBe(200);
    expect((refused as ApiError).body).toBe('<html>proxy</html>');
  });

  it('answers a 2xx with its JSON', async () => {
    route('POST', '/api/friends/add', { body: { ok: true, username: 'ana' } });
    await expect(api('POST friends/add', { body: { username: 'ana' } })).resolves.toEqual({ ok: true, username: 'ana' });
  });

  it('rejects a non-2xx with an ApiError carrying the status and the server payload', async () => {
    route('POST', '/api/auth/login', { status: 401, body: { code: 'INVALID_CREDENTIALS', message: 'no' } });
    const refused = await api('POST auth/login', { body: { username: 'a', password: 'b' } }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ApiError);
    expect((refused as ApiError).status).toBe(401);
    expect((refused as ApiError).payload).toEqual({ code: 'INVALID_CREDENTIALS', message: 'no' });
  });

  it('rejects with what fetch threw when the network is down', async () => {
    route('POST', '/api/auth/logout', unreachable);
    await expect(api('POST auth/logout')).rejects.toThrow('Network request failed');
  });

  it('fills path params, encodes the query, and reads a cache key as a GET', async () => {
    route('DELETE', '/api/friends/requests/a%2Fb', { body: { ok: true } });
    route('GET', '/api/users/search', { body: { id: 'u1', username: 'ana b' } });
    route('GET', '/api/friends', { body: [] });
    await api('DELETE friends/requests/:id', { params: { id: 'a/b' } });
    await api('GET users/search', { query: { username: 'ana b' } });
    await expect(api(queryKey('friends'))).resolves.toEqual([]);
    expect(new URL(httpRequests()[1].url).searchParams.get('username')).toBe('ana b');
    expect(httpRequests().map((r) => r.method)).toEqual(['DELETE', 'GET', 'GET']);
  });

  it('refuses at compile time a body field the contract does not name', () => {
    route('POST', '/api/auth/change-password', { body: { ok: true } });
    // @ts-expect-error `oldPassword` is not ChangePasswordSchema's field, even beside every one that is.
    void api('POST auth/change-password', { body: { currentPassword: 'x', newPassword: 'y', oldPassword: 'x' } });
    // @ts-expect-error a route that takes a body cannot be sent without one.
    void api('POST auth/change-password');
  });
});
