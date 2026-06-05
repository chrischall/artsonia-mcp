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
});
