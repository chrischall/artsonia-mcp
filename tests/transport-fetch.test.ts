import { describe, it, expect, vi, afterEach } from 'vitest';
import { FetchArtsoniaTransport } from '../src/transport-fetch.js';

function mockFetch(impl: (url: string, init: any) => Response) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(((url: any, init: any) =>
    Promise.resolve(impl(String(url), init))) as any);
}

afterEach(() => vi.restoreAllMocks());

describe('FetchArtsoniaTransport', () => {
  it('prefixes relative paths with the artsonia origin and returns body+url', async () => {
    let seenUrl = '';
    mockFetch((url) => { seenUrl = url; return new Response('<html>ok</html>', { status: 200 }); });
    const t = new FetchArtsoniaTransport();
    const res = await t.request({ method: 'GET', path: '/members/' });
    expect(seenUrl).toBe('https://www.artsonia.com/members/');
    expect(res.status).toBe(200);
    expect(res.body).toContain('ok');
  });

  it('collects Set-Cookie lines and the Location header on a manual redirect', async () => {
    mockFetch(() => new Response('', {
      status: 302,
      headers: { 'set-cookie': 'SID=xyz; path=/; HttpOnly', location: '/members/' },
    }));
    const t = new FetchArtsoniaTransport();
    const res = await t.request({ method: 'POST', path: '/members/login.asp', body: 'a=b', redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.setCookie.some((c) => c.startsWith('SID=xyz'))).toBe(true);
    expect(res.location).toBe('/members/');
  });
});
