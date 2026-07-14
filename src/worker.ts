import { createConnector } from '@chrischall/mcp-connector';
import { ArtsoniaClient, createDirectClient } from './client-core.js';
import { artsoniaAuth, type ArtsoniaProps } from './artsonia-auth.js';
import { registerHealthcheckTools } from './tools/healthcheck.js';
import { registerStudentTools } from './tools/students.js';
import { registerPortfolioTools } from './tools/portfolio.js';
import { registerFanTools } from './tools/fans.js';
import { registerFeedbackTools } from './tools/feedback.js';
import { registerAccountTools } from './tools/account.js';
import { registerDownloadTools } from './tools/download.js';
import { registerWriteTools } from './tools/writes.js';
import { InlineDownloadIO } from './tools/download-io-inline.js';
import pkg from '../package.json' with { type: 'json' };

// The Cloudflare remote-connector entrypoint: wires the same transport-neutral
// tool registrars the stdio server uses (`src/index.ts`) into
// `@chrischall/mcp-connector`'s generic OAuth + McpAgent harness. Each user logs
// in on the connector's own OAuth page with their personal Artsonia email +
// password (`src/artsonia-auth.ts`), and `buildClient` mints a per-user,
// DIRECT-mode `ArtsoniaClient` (via `createDirectClient`, which never touches the
// fetchproxy transport) whose injected credentials let it re-run Artsonia's form
// login as the session cookie expires — so concurrent sessions never share a jar.
//
// Artsonia is STATELESS — there is no local cache, so unlike the OFW connector
// this Worker declares only the `MCP_OBJECT` per-session agent Durable Object
// (no cache DO, no cache provider). The download tool, which writes to disk on
// the stdio server, is registered here with an INLINE download IO that returns
// image bytes as MCP content blocks instead (the Worker has no filesystem), so
// the full tool surface is hosted.
const { Agent, handler } = createConnector<ArtsoniaProps, ArtsoniaClient>({
  name: 'artsonia-mcp',
  version: pkg.version,
  auth: artsoniaAuth,
  buildClient: (props) => createDirectClient({ username: props.username, password: props.password }),
  // Keep the SAME order as src/index.ts.
  tools: [
    registerHealthcheckTools,
    registerStudentTools,
    registerPortfolioTools,
    registerFanTools,
    registerFeedbackTools,
    registerAccountTools,
    (server, client) => registerDownloadTools(server, client, new InlineDownloadIO()),
    registerWriteTools,
  ],
});

// The connector's per-session MCP agent Durable Object
// (`wrangler.jsonc`'s `MCP_OBJECT` → `ArtsoniaMcpAgent`) resolves this export.
export { Agent as ArtsoniaMcpAgent };

export default handler;
