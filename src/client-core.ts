import { loadDotenvSafely, McpToolError } from '@chrischall/mcp-utils';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthManager, looksUnauthenticated } from './auth.js';
import { FetchArtsoniaTransport } from './transport-fetch.js';
import type { ArtsoniaResponse, ArtsoniaTransport } from './transport.js';

// Load `.env` next to the compiled entry point. `loadDotenvSafely` is a no-throw
// loader; the try/catch additionally guards the Cloudflare Worker runtime, where
// `import.meta.url` is undefined and `fileURLToPath(undefined)` would otherwise
// throw at module init (Worker startup validation, code 10021) — there is no
// filesystem / `.env` to load there anyway. Both stdio (via client.ts) and the
// Worker (via worker.ts → client-core.ts) reach this module, so the guard is
// what keeps the Worker from crashing on load. Real env vars still win
// (`override: false`).
try {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  await loadDotenvSafely({ path: join(__dirname, '..', '.env'), override: false });
} catch {
  /* v8 ignore next -- only reached in a non-Node runtime (Workers): no .env to load */
}

export interface ArtsoniaClientOptions {
  transport: ArtsoniaTransport;
  auth: AuthManager;
}

// Thin, tool-facing API over a transport + AuthManager. Reads go through
// fetchHtml(); writes through write(). Both ensure a live session and retry
// once across a re-login if the response looks unauthenticated.
//
// This module is WORKER-SAFE: it imports only the direct FetchArtsoniaTransport
// (no `@fetchproxy/server`) and the leaf transport types. The env-driven
// stdio singleton (which pulls in the fetchproxy fallback via make-transport.ts)
// lives in client.ts, which re-exports this class.
export class ArtsoniaClient {
  private readonly transport: ArtsoniaTransport;
  private readonly auth: AuthManager;

  constructor(opts: ArtsoniaClientOptions) {
    this.transport = opts.transport;
    this.auth = opts.auth;
  }

  async fetchHtml(path: string): Promise<string> {
    return (await this.requestWithSession('GET', path)).body;
  }

  async write(path: string, body: string): Promise<ArtsoniaResponse> {
    return this.requestWithSession('POST', path, body);
  }

  private async requestWithSession(method: 'GET' | 'POST', path: string, body?: string): Promise<ArtsoniaResponse> {
    // fetchproxy transport mode: the request rides the user's already-signed-in
    // browser tab, which carries the session. The server-side username/password
    // login does NOT apply (no jar to fill, and doLogin's 302+Location success
    // marker never appears — the browser follows the redirect itself, so
    // ensureLogin would always throw "Artsonia login failed"). Send straight
    // through; if the browser isn't signed in, the response looks like the login
    // page and we surface a browser-specific hint instead of a credential one.
    if (this.transport.usesBrowserSession) {
      const res = await this.send(method, path, body);
      if (looksUnauthenticated(res)) {
        throw new McpToolError('Not signed in to Artsonia in your browser.', {
          hint: 'fetchproxy mode uses your signed-in browser session — no ARTSONIA_USERNAME/PASSWORD needed. Open www.artsonia.com in the bridged browser tab and sign in, then retry.',
        });
      }
      if (res.status >= 400) {
        throw new McpToolError(`Artsonia request failed: ${method} ${path} -> HTTP ${res.status}`, {
          hint: 'Retry; if it persists the page may have moved or requires a different account.',
        });
      }
      return res;
    }

    // Direct mode: the manager owns the one-replay-on-expiry. It ensures a live
    // session, runs the request, and on a redirect-away-to-login (isExpired)
    // invalidates + single-flight re-logs-in + replays the request EXACTLY once.
    // What surfaces here is the FINAL response: still login-looking means either
    // a persistent expiry or a failed re-login — both reported as a sign-in error.
    const res = await this.auth.withSession(() => this.send(method, path, body));
    if (looksUnauthenticated(res)) {
      throw new McpToolError('Artsonia session could not be (re)established after re-login.', {
        hint: 'Your ARTSONIA_USERNAME / ARTSONIA_PASSWORD may be wrong, or the session keeps expiring. Verify the credentials.',
      });
    }
    this.auth.absorb(res.setCookie);
    if (res.status >= 400) {
      throw new McpToolError(`Artsonia request failed: ${method} ${path} -> HTTP ${res.status}`, {
        hint: 'Retry; if it persists the page may have moved or requires a different account.',
      });
    }
    return res;
  }

  private send(method: 'GET' | 'POST', path: string, body?: string): Promise<ArtsoniaResponse> {
    const headers: Record<string, string> = {};
    // In browser-session (fetchproxy) mode the tab carries its own cookies; the
    // server jar is empty, so don't override the browser's Cookie header.
    if (!this.transport.usesBrowserSession) headers.Cookie = this.auth.cookieHeader();
    if (method === 'POST') headers['Content-Type'] = 'application/x-www-form-urlencoded';
    return this.transport.request({ method, path, headers, body, redirect: method === 'POST' ? 'manual' : 'follow' });
  }
}

/**
 * Build a per-user, DIRECT-mode `ArtsoniaClient` from injected credentials — the
 * injectable constructor seam the hosted Cloudflare connector uses. Each call
 * mints its own `FetchArtsoniaTransport` + `AuthManager(username/password)`, so
 * concurrent connector sessions never share a cookie jar. Direct mode only:
 * there is no browser tab on the Worker, so the fetchproxy transport (and
 * `make-transport.ts`, which carries it) is intentionally never referenced here.
 */
export function createDirectClient(opts: { username?: string; password?: string }): ArtsoniaClient {
  const transport = new FetchArtsoniaTransport();
  return new ArtsoniaClient({ transport, auth: new AuthManager(transport, opts) });
}
