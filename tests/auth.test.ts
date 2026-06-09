import { describe, it, expect, vi } from 'vitest';
import { AuthManager } from '../src/auth.js';
import type { ArtsoniaRequest, ArtsoniaResponse, ArtsoniaTransport } from '../src/transport.js';

function fakeTransport(handler: (req: ArtsoniaRequest) => ArtsoniaResponse): ArtsoniaTransport & { calls: ArtsoniaRequest[] } {
  const calls: ArtsoniaRequest[] = [];
  return { calls, request: async (req) => { calls.push(req); return handler(req); } };
}

const okLogin = (): ArtsoniaResponse => ({ status: 302, body: '', url: 'https://www.artsonia.com/members/login.asp', setCookie: ['SID=good; path=/; HttpOnly'], location: '/members/' });

describe('AuthManager', () => {
  it('throws a deferred config error when creds are missing', async () => {
    const t = fakeTransport(okLogin);
    const auth = new AuthManager(t, {}); // no username/password
    await expect(auth.ensureLogin()).rejects.toThrow(/ARTSONIA_USERNAME/);
  });

  it('posts the verified login form and captures the session cookie', async () => {
    const t = fakeTransport(okLogin);
    const auth = new AuthManager(t, { username: 'u@example.com', password: 'pw' });
    await auth.ensureLogin();
    const post = t.calls[0];
    expect(post.method).toBe('POST');
    expect(post.path).toBe('/members/login.asp');
    expect(post.redirect).toBe('manual');
    expect(post.headers?.['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(post.body).toContain('Username=u%40example.com');
    expect(post.body).toContain('Password=pw');
    expect(post.body).toContain('Action=login');
    expect(post.body).toContain('TargetUrl=%2Fmembers%2F');
    expect(auth.cookieHeader()).toBe('SID=good');
  });

  it('does not log in twice when already authenticated', async () => {
    const t = fakeTransport(okLogin);
    const auth = new AuthManager(t, { username: 'u@example.com', password: 'pw' });
    await auth.ensureLogin();
    await auth.ensureLogin();
    expect(t.calls.length).toBe(1);
  });

  it('throws SessionNotAuthenticatedError when login is rejected (200 re-render, no redirect)', async () => {
    const t = fakeTransport(() => ({ status: 200, body: 'Parent (or Fan) Login', url: 'https://www.artsonia.com/members/login.asp', setCookie: [] }));
    const auth = new AuthManager(t, { username: 'u@example.com', password: 'bad' });
    await expect(auth.ensureLogin()).rejects.toThrow(/credentials|sign in|log in/i);
  });

  it('forceRelogin() re-posts even if a session already exists', async () => {
    const t = fakeTransport(okLogin);
    const auth = new AuthManager(t, { username: 'u@example.com', password: 'pw' });
    await auth.ensureLogin();
    await auth.forceRelogin();
    expect(t.calls.length).toBe(2);
  });

  it('single-flights concurrent ensureLogin() into ONE login POST', async () => {
    let resolve!: (r: ArtsoniaResponse) => void;
    const t = fakeTransport(() => new Promise<ArtsoniaResponse>((r) => { resolve = r; }) as unknown as ArtsoniaResponse);
    const auth = new AuthManager(t, { username: 'u@example.com', password: 'pw' });
    const a = auth.ensureLogin();
    const b = auth.ensureLogin();
    resolve(okLogin());
    await Promise.all([a, b]);
    expect(t.calls.length).toBe(1); // both callers shared the in-flight login
  });

  it('caches the missing-creds config error permanently (no login attempt, rethrown every call)', async () => {
    const t = fakeTransport(okLogin);
    const auth = new AuthManager(t, {}); // no creds
    await expect(auth.ensureLogin()).rejects.toThrow(/ARTSONIA_USERNAME/);
    await expect(auth.ensureLogin()).rejects.toThrow(/ARTSONIA_USERNAME/);
    expect(t.calls.length).toBe(0); // never hit the transport
  });

  it('a rejected (bad-creds) login is transient — the next forceRelogin retries', async () => {
    let attempt = 0;
    const t = fakeTransport(() => {
      attempt += 1;
      return attempt === 1
        ? { status: 200, body: 'Parent (or Fan) Login', url: 'https://www.artsonia.com/members/login.asp', setCookie: [] }
        : okLogin();
    });
    const auth = new AuthManager(t, { username: 'u@example.com', password: 'pw' });
    await expect(auth.ensureLogin()).rejects.toThrow(/credentials|sign in|log in/i);
    await auth.forceRelogin(); // not cached → retries and succeeds
    expect(auth.cookieHeader()).toBe('SID=good');
    expect(t.calls.length).toBe(2);
  });
});
