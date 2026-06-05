import { loadDotenvSafely, readEnvVar, McpToolError } from '@chrischall/mcp-utils';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthManager } from './auth.js';
import { makeTransport, type ArtsoniaResponse, type ArtsoniaTransport } from './transport.js';

const LOGIN_RE = /\/members\/login\.asp/i;
const LOGIN_BODY_RE = /You need to log in|Parent \(or Fan\) Login/i;

function looksUnauthenticated(res: ArtsoniaResponse): boolean {
  return LOGIN_RE.test(res.url) || LOGIN_BODY_RE.test(res.body) || (res.location ? LOGIN_RE.test(res.location) : false);
}

export interface ArtsoniaClientOptions {
  transport: ArtsoniaTransport;
  auth: AuthManager;
}

// Thin, tool-facing API over a transport + AuthManager. Reads go through
// fetchHtml(); writes through write(). Both ensure a live session and retry
// once across a re-login if the response looks unauthenticated.
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
    await this.auth.ensureLogin();
    let res = await this.send(method, path, body);
    if (looksUnauthenticated(res)) {
      this.auth.invalidate();
      try {
        await this.auth.forceRelogin();
      } catch {
        throw new McpToolError('Artsonia session could not be re-established: login failed after session expired.', {
          hint: 'Your ARTSONIA_USERNAME / ARTSONIA_PASSWORD may be wrong, or the session keeps expiring. Verify the credentials.',
        });
      }
      res = await this.send(method, path, body);
      if (looksUnauthenticated(res)) {
        throw new McpToolError('Artsonia session could not be (re)established after re-login.', {
          hint: 'Your ARTSONIA_USERNAME / ARTSONIA_PASSWORD may be wrong, or the session keeps expiring. Verify the credentials.',
        });
      }
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
    const headers: Record<string, string> = { Cookie: this.auth.cookieHeader() };
    if (method === 'POST') headers['Content-Type'] = 'application/x-www-form-urlencoded';
    return this.transport.request({ method, path, headers, body, redirect: method === 'POST' ? 'manual' : 'follow' });
  }
}

// Module singleton, constructed in this module (not index.ts) so the
// deferred-config-error pattern holds: the server boots and answers tools/list
// even with no creds; the error surfaces on the first tool call.
const __dirname = dirname(fileURLToPath(import.meta.url));
await loadDotenvSafely({ path: join(__dirname, '..', '.env'), override: false });

const transport = await makeTransport();
export const client = new ArtsoniaClient({
  transport,
  auth: new AuthManager(transport, {
    username: readEnvVar('ARTSONIA_USERNAME'),
    password: readEnvVar('ARTSONIA_PASSWORD'),
  }),
});
