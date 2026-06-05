import { FetchproxyServer, type FetchproxyServerOpts } from '@fetchproxy/server';
import { ARTSONIA_ORIGIN, type ArtsoniaRequest, type ArtsoniaResponse, type ArtsoniaTransport } from './transport.js';
import { readEnvVar } from '@chrischall/mcp-utils';
import { VERSION } from './version.js';

const DEFAULT_PORT = 37_149; // shared fleet port — do NOT change

// Optional fallback transport: route requests through the user's signed-in
// browser tab via @fetchproxy/server. Engaged only when ARTSONIA_TRANSPORT=
// fetchproxy. Cookies are carried by the browser, so the AuthManager's jar is
// unused in this mode; login is whatever the browser already holds.
export class FetchproxyArtsoniaTransport implements ArtsoniaTransport {
  private readonly inner: FetchproxyServer;
  private started = false;

  constructor() {
    const portEnv = readEnvVar('ARTSONIA_WS_PORT');
    const opts: FetchproxyServerOpts = {
      port: portEnv ? Number(portEnv) : DEFAULT_PORT,
      serverName: 'artsonia-mcp',
      version: VERSION,
      domains: ['artsonia.com'],
      capabilities: ['fetch'] as const,
    };
    this.inner = new FetchproxyServer(opts);
  }

  private async ensureStarted(): Promise<void> {
    if (this.started) return;
    await this.inner.listen();
    this.started = true;
  }

  async request(req: ArtsoniaRequest): Promise<ArtsoniaResponse> {
    await this.ensureStarted();
    const url = req.path.startsWith('http') ? req.path : `${ARTSONIA_ORIGIN}${req.path}`;
    const r = await this.inner.request(req.method, url, { headers: req.headers, body: req.body });
    return { status: r.status, body: r.body, url: r.url, setCookie: [] };
  }
}
