import { ARTSONIA_ORIGIN, type ArtsoniaRequest, type ArtsoniaResponse, type ArtsoniaTransport } from './transport.js';

const DEFAULT_TIMEOUT_MS = 30_000;

// Default transport: node fetch against the user's cookie session. The login
// POST passes redirect:'manual' so its 302's Set-Cookie is readable; reads use
// redirect:'follow' and detect login-redirects by the final URL/body.
export class FetchArtsoniaTransport implements ArtsoniaTransport {
  async request(req: ArtsoniaRequest): Promise<ArtsoniaResponse> {
    const url = req.path.startsWith('http') ? req.path : `${ARTSONIA_ORIGIN}${req.path}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: req.method,
        headers: req.headers,
        body: req.body,
        redirect: req.redirect ?? 'follow',
        signal: ac.signal,
      });
      const body = await res.text();
      const setCookie = typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : (res.headers.get('set-cookie') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      const location = res.headers.get('location') ?? undefined;
      return { status: res.status, body, url: res.url || url, setCookie, location };
    } finally {
      clearTimeout(timer);
    }
  }
}
