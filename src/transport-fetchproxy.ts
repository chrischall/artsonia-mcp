// `import type` is erased at build time, so it produces NO runtime import — the
// only runtime reference to the fetchproxy stack is the lazy `import()` inside
// ensureStarted(). This matters for the bundled `.mcpb`: it externalizes BOTH
// `@fetchproxy/server` and `@chrischall/mcp-utils/fetchproxy` (the shared
// adapter subpath eagerly imports `@fetchproxy/server`, so bundling it would
// hoist that import to the bundle's top level) and ships no node_modules, so an
// eager import would crash the server at load (ERR_MODULE_NOT_FOUND) even in
// the default `fetch` transport. Keeping the import lazy means fetch mode never
// touches it.
import type { FetchproxyTransport as FetchproxyTransportAdapter } from '@chrischall/mcp-utils/fetchproxy';
import type { ArtsoniaRequest, ArtsoniaResponse, ArtsoniaTransport } from './transport.js';
import { readEnvVar } from '@chrischall/mcp-utils';
import { VERSION } from './version.js';

const DEFAULT_PORT = 37_149; // shared fleet port — do NOT change

// Optional fallback transport: route requests through the user's signed-in
// browser tab via @fetchproxy/server. Engaged only when ARTSONIA_TRANSPORT=
// fetchproxy. Cookies are carried by the browser, so the AuthManager's jar is
// unused in this mode; login is whatever the browser already holds.
//
// The FetchproxyServer construction + start lifecycle lives in mcp-utils'
// createFetchproxyTransport (the boilerplate the fetchproxy fleet shares);
// this class keeps only the Artsonia-specific bits: the lazy import, the
// one-time adapter construction, and the {status, body, url, setCookie}
// response mapping.
export class FetchproxyArtsoniaTransport implements ArtsoniaTransport {
  /** The browser tab carries the session — never run the server-side login. */
  readonly usesBrowserSession = true;
  private adapter: Promise<FetchproxyTransportAdapter> | null = null;

  // Memoized one-time init: the factory owns FetchproxyServer construction +
  // start() (identity load; the bridge connection itself is lazy on first
  // verb), but nothing above us guarantees the factory is invoked exactly
  // once — so concurrent first-calls share this one promise and we never
  // construct two adapters. A failed init clears the memo so a later call
  // can retry.
  private ensureStarted(): Promise<FetchproxyTransportAdapter> {
    if (!this.adapter) {
      this.adapter = (async () => {
        // Lazy import: only loaded when fetchproxy mode is actually used.
        const { createFetchproxyTransport } = await import('@chrischall/mcp-utils/fetchproxy');
        const portEnv = readEnvVar('ARTSONIA_WS_PORT');
        const transport = createFetchproxyTransport({
          port: portEnv ? Number(portEnv) : DEFAULT_PORT,
          serverName: 'artsonia-mcp',
          version: VERSION,
          domains: ['artsonia.com'],
          capabilities: ['fetch'],
          // Relative ArtsoniaRequest paths resolve against www.artsonia.com
          // (= the old ARTSONIA_ORIGIN); absolute URLs self-describe their host.
          defaultSubdomain: 'www',
        });
        await transport.start();
        return transport;
      })();
      this.adapter.catch(() => { this.adapter = null; });
    }
    return this.adapter;
  }

  async request(req: ArtsoniaRequest): Promise<ArtsoniaResponse> {
    const transport = await this.ensureStarted();
    const r = await transport.fetch({
      method: req.method,
      path: req.path,
      headers: req.headers,
      body: req.body,
    });
    // The browser follows redirects itself, so `redirect: 'manual'` doesn't
    // apply and no Set-Cookie/Location ever surfaces here (the tab owns both).
    return { status: r.status, body: r.body, url: r.url, setCookie: [] };
  }
}
