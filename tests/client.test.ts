import { describe, it, expect } from 'vitest';
import { ArtsoniaClient } from '../src/client.js';
import { AuthManager } from '../src/auth.js';
import type { ArtsoniaRequest, ArtsoniaResponse, ArtsoniaTransport } from '../src/transport.js';

function scriptedTransport(steps: Array<(req: ArtsoniaRequest) => ArtsoniaResponse>): ArtsoniaTransport & { calls: ArtsoniaRequest[] } {
  const calls: ArtsoniaRequest[] = [];
  let i = 0;
  return { calls, request: async (req) => { calls.push(req); const step = steps[Math.min(i, steps.length - 1)]; i++; return step(req); } };
}

const loginOk = (): ArtsoniaResponse => ({ status: 302, body: '', url: 'https://www.artsonia.com/members/login.asp', setCookie: ['SID=good'], location: '/members/' });

function makeClient(t: ArtsoniaTransport) {
  const auth = new AuthManager(t, { username: 'u@example.com', password: 'pw' });
  return new ArtsoniaClient({ transport: t, auth });
}

describe('ArtsoniaClient.fetchHtml', () => {
  it('logs in first, then GETs the path with the session cookie', async () => {
    const t = scriptedTransport([loginOk, () => ({ status: 200, body: '<html>dash</html>', url: 'https://www.artsonia.com/members/', setCookie: [] })]);
    const html = await makeClient(t).fetchHtml('/members/');
    expect(html).toContain('dash');
    const get = t.calls[1];
    expect(get.method).toBe('GET');
    expect(get.headers?.Cookie).toBe('SID=good');
  });

  it('re-logs-in once and retries when a read redirects back to login', async () => {
    const t = scriptedTransport([
      loginOk,
      () => ({ status: 200, body: 'You need to log in to continue.', url: 'https://www.artsonia.com/members/login.asp', setCookie: [] }),
      loginOk,
      () => ({ status: 200, body: '<html>dash</html>', url: 'https://www.artsonia.com/members/', setCookie: [] }),
    ]);
    const html = await makeClient(t).fetchHtml('/members/');
    expect(html).toContain('dash');
    expect(t.calls.filter((c) => c.path === '/members/login.asp').length).toBe(2);
  });

  it('throws when still unauthenticated after one re-login', async () => {
    const t = scriptedTransport([loginOk, () => ({ status: 200, body: 'You need to log in', url: 'https://www.artsonia.com/members/login.asp', setCookie: [] })]);
    await expect(makeClient(t).fetchHtml('/members/')).rejects.toThrow(/log in|sign in|authenticated|session/i);
  });

  it('write() posts form-urlencoded with the session cookie', async () => {
    const t = scriptedTransport([loginOk, () => ({ status: 302, body: '', url: 'https://www.artsonia.com/members/', setCookie: [], location: '/members/' })]);
    const res = await makeClient(t).write('/museum/enter.asp?artist=1&art=2', 'Comment=hi');
    expect(res.status).toBe(302);
    const post = t.calls[1];
    expect(post.method).toBe('POST');
    expect(post.headers?.['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(post.headers?.Cookie).toBe('SID=good');
    expect(post.body).toBe('Comment=hi');
  });
});
