// `import type` is erased at build time, so it produces NO runtime import — the
// only runtime reference to `@fetchproxy/server` is the lazy `import()` inside
// ensureStarted(). This matters for the bundled `.mcpb`: it externalizes
// @fetchproxy/server and ships no node_modules, so an eager top-level import
// would crash the server at load (ERR_MODULE_NOT_FOUND) even in the default
// `fetch` transport. Keeping the import lazy means fetch mode never touches it.
import type { FetchproxyServer, FetchproxyServerOpts } from '@fetchproxy/server';
import { ARTSONIA_ORIGIN, type ArtsoniaRequest, type ArtsoniaResponse, type ArtsoniaTransport } from './transport.js';
import { readEnvVar } from '@chrischall/mcp-utils';
import { VERSION } from './version.js';

const DEFAULT_PORT = 37_149; // shared fleet port — do NOT change

// Optional fallback transport: route requests through the user's signed-in
// browser tab via @fetchproxy/server. Engaged only when ARTSONIA_TRANSPORT=
// fetchproxy. Cookies are carried by the browser, so the AuthManager's jar is
// unused in this mode; login is whatever the browser already holds.
export class FetchproxyArtsoniaTransport implements ArtsoniaTransport {
  /** The browser tab carries the session — never run the server-side login. */
  readonly usesBrowserSession = true;
  private inner: FetchproxyServer | null = null;
  private started = false;
  private starting: Promise<void> | null = null;

  private buildOpts(): FetchproxyServerOpts {
    const portEnv = readEnvVar('ARTSONIA_WS_PORT');
    return {
      port: portEnv ? Number(portEnv) : DEFAULT_PORT,
      serverName: 'artsonia-mcp',
      version: VERSION,
      domains: ['artsonia.com'],
      capabilities: ['fetch'] as const,
    };
  }

  private async ensureStarted(): Promise<void> {
    if (this.started) return;
    // Single-flight: concurrent first-calls share one init so we never construct
    // two FetchproxyServers / bind the shared port twice.
    if (this.starting) return this.starting;
    this.starting = (async () => {
      // Lazy import: only loaded when fetchproxy mode is actually used.
      const { FetchproxyServer } = await import('@fetchproxy/server');
      this.inner = new FetchproxyServer(this.buildOpts());
      await this.inner.listen();
      this.started = true;
    })().finally(() => { this.starting = null; });
    return this.starting;
  }

  async request(req: ArtsoniaRequest): Promise<ArtsoniaResponse> {
    await this.ensureStarted();
    const url = req.path.startsWith('http') ? req.path : `${ARTSONIA_ORIGIN}${req.path}`;
    const r = await this.inner!.request(req.method, url, { headers: req.headers, body: req.body });
    return { status: r.status, body: r.body, url: r.url, setCookie: [] };
  }
}
