import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthManager } from '../src/auth.js';
import type { ArtsoniaRequest, ArtsoniaResponse, ArtsoniaTransport } from '../src/transport.js';

function fakeTransport(handler: (req: ArtsoniaRequest) => ArtsoniaResponse): ArtsoniaTransport & { calls: ArtsoniaRequest[] } {
  const calls: ArtsoniaRequest[] = [];
  return { calls, request: async (req) => { calls.push(req); return handler(req); } };
}

const okLogin = (): ArtsoniaResponse => ({ status: 302, body: '', url: 'https://www.artsonia.com/members/login.asp', setCookie: ['SID=good; path=/; HttpOnly'], location: '/members/' });

describe('AuthManager', () => {
  // Hermetic env: the "missing creds" cases assert on AuthManager's own
  // config error, which falls through to readEnvVar('ARTSONIA_USERNAME' /
  // '_PASSWORD'). Without this, a developer shell that exports those vars
  // makes `new AuthManager(t, {})` silently authenticate and the two
  // missing-creds tests fail (see issue #74). Blank them for every test;
  // the cred-carrying tests pass creds via opts, so they're unaffected.
  beforeEach(() => {
    vi.stubEnv('ARTSONIA_USERNAME', '');
    vi.stubEnv('ARTSONIA_PASSWORD', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

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

describe('AuthManager — session cache', () => {
  // These stub env vars; without an explicit unstub they leak into every later
  // test in the file (the hermetic block at the top only covers its own describe).
  afterEach(() => vi.unstubAllEnvs());

  const okLoginTwice = (): ArtsoniaResponse => okLogin();

  it('a second manager restores the jar and does not log in again', async () => {
    // End to end through the adapter: the live session holds a CookieJar, the
    // cache holds its rendered header, and this is what proves the mapping
    // works in both directions rather than only in the unit test.
    const dir = mkdtempSync(join(tmpdir(), 'artsonia-hit-'));
    try {
      vi.stubEnv('ARTSONIA_SESSION_CACHE', 'true');
      vi.stubEnv('ARTSONIA_SESSION_FILE', join(dir, 'session.json'));

      const first = fakeTransport(okLoginTwice);
      const a = new AuthManager(first, { username: 'u@example.com', password: 'pw' });
      await a.ensureLogin();
      expect(first.calls.length).toBeGreaterThan(0);

      const second = fakeTransport(okLoginTwice);
      const b = new AuthManager(second, { username: 'u@example.com', password: 'pw' });
      await b.ensureLogin();
      expect(second.calls).toHaveLength(0); // restored, no login POST
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('binds to the credentials the manager was constructed with', async () => {
    // AuthManager takes creds via opts as well as the environment. Binding to
    // the env pair would mean a per-user client either never caches or reads a
    // record keyed to somebody else.
    const dir = mkdtempSync(join(tmpdir(), 'artsonia-bind-'));
    try {
      vi.stubEnv('ARTSONIA_SESSION_CACHE', 'true');
      vi.stubEnv('ARTSONIA_SESSION_FILE', join(dir, 'session.json'));

      const first = fakeTransport(okLoginTwice);
      await new AuthManager(first, { username: 'a@example.com', password: 'pw' }).ensureLogin();

      const other = fakeTransport(okLoginTwice);
      await new AuthManager(other, { username: 'b@example.com', password: 'pw' }).ensureLogin();
      expect(other.calls.length).toBeGreaterThan(0); // different user → own login
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('AuthManager — an expired session clears the cache', () => {
  // These stub env vars; without an explicit unstub they leak into every later
  // test in the file (the hermetic block at the top only covers its own describe).
  afterEach(() => vi.unstubAllEnvs());

  it('does not restore a session that withSession already invalidated', async () => {
    // The clear half of the adapter. Without it an expired cookie would be read
    // straight back off disk on the next start and the expiry would repeat —
    // the cache turning a one-request cost into a permanent one.
    const dir = mkdtempSync(join(tmpdir(), 'artsonia-clear-'));
    try {
      vi.stubEnv('ARTSONIA_SESSION_CACHE', 'true');
      vi.stubEnv('ARTSONIA_SESSION_FILE', join(dir, 'session.json'));

      // Seed a cached session with a successful login.
      const seed = fakeTransport(okLogin);
      await new AuthManager(seed, { username: 'u@example.com', password: 'pw' }).ensureLogin();

      // Now drive an expiry whose RE-LOGIN also fails, so nothing re-saves and
      // the cleared state is what survives. (A successful re-login would save a
      // fresh record — correct, but it would hide whether the clear ran.)
      let logins = 0;
      const t = fakeTransport((req) => {
        if (req.path?.includes('login')) {
          logins += 1;
          // The restored session is used first, so the only login here is the
          // re-login after the expiry — fail it.
          return { status: 200, body: 'bad credentials', url: 'https://www.artsonia.com/members/login.asp', setCookie: [] };
        }
        return { status: 200, body: '', url: 'https://www.artsonia.com/members/login.asp', setCookie: [] };
      });
      const auth = new AuthManager(t, { username: 'u@example.com', password: 'pw' });
      await auth
        .withSession(async () =>
          t.request({ method: 'GET', path: '/members/home.asp' } as ArtsoniaRequest),
        )
        .catch(() => undefined);
      expect(logins).toBeGreaterThan(0);

      // The invalidate cleared the record, so a fresh manager must log in.
      const next = fakeTransport(okLogin);
      await new AuthManager(next, { username: 'u@example.com', password: 'pw' }).ensureLogin();
      expect(next.calls.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
