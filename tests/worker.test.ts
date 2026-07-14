import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { createDirectClient } from '../src/client-core.js';
import { registerHealthcheckTools } from '../src/tools/healthcheck.js';
import { registerStudentTools } from '../src/tools/students.js';
import { registerPortfolioTools } from '../src/tools/portfolio.js';
import { registerFanTools } from '../src/tools/fans.js';
import { registerFeedbackTools } from '../src/tools/feedback.js';
import { registerAccountTools } from '../src/tools/account.js';
import { registerDownloadTools } from '../src/tools/download.js';
import { registerWriteTools } from '../src/tools/writes.js';
import { InlineDownloadIO } from '../src/tools/download-io-inline.js';

// Handshake + tool-surface test for the Artsonia Cloudflare remote connector, run
// inside the real Workers runtime (Miniflare) via
// `@cloudflare/vitest-pool-workers` against `wrangler.jsonc`. It proves three
// things that don't require a live Artsonia session:
//   1. the OAuth default handler serves discovery + the login page,
//   2. an unauthenticated `/mcp` request is rejected before any tool code runs,
//   3. the exact registrar wiring `src/worker.ts` uses registers the full
//      Artsonia tool surface (including the download tool with the inline IO).
//
// The full authenticated `initialize` + `tools/list` handshake over `/mcp`
// requires a real OAuth access token minted via `workers-oauth-provider`'s
// KV-backed grant flow (POST /authorize with real creds → auth code →
// POST /token), which would mean a live Artsonia login — out of scope for a
// hermetic in-process test. So #3 asserts tool registration through the same
// in-memory MCP harness the stdio suite uses, wired exactly as `worker.ts` wires
// it, rather than through the token-gated `/mcp` route.

describe('Artsonia Cloudflare connector — OAuth surface', () => {
  it('serves the OAuth authorization-server discovery document', async () => {
    const res = await SELF.fetch('https://example.com/.well-known/oauth-authorization-server');
    expect(res.status).toBe(200);
    const meta = (await res.json()) as { authorization_endpoint?: string; token_endpoint?: string };
    expect(meta.authorization_endpoint).toContain('/authorize');
    expect(meta.token_endpoint).toContain('/token');
  });

  it('rejects an unauthenticated /mcp request', async () => {
    const res = await SELF.fetch('https://example.com/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    expect(res.status).toBe(401);
  });

  it('GET /authorize renders the Artsonia login page with the email + password fields', async () => {
    // No `client_id` query param: the login page renders without needing a
    // registered OAuth client, which is all we verify here.
    const res = await SELF.fetch('https://example.com/authorize?response_type=code&state=abc');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Artsonia');
    expect(html).toContain('Artsonia email or username');
    expect(html).toContain('Artsonia password');
    expect(html).toContain('type="password"');
  });
});

describe('Artsonia Cloudflare connector — tool surface', () => {
  it('registers the full Artsonia tool set via the same wiring as worker.ts', async () => {
    // No creds needed: the roster test only registers tools, never invokes them.
    const client = createDirectClient({});

    // Mirror src/worker.ts's `tools` array exactly (same order, same wiring),
    // including the download tool's inline (filesystem-free) IO.
    const harness = await createTestHarness((server) => {
      registerHealthcheckTools(server, client);
      registerStudentTools(server, client);
      registerPortfolioTools(server, client);
      registerFanTools(server, client);
      registerFeedbackTools(server, client);
      registerAccountTools(server, client);
      registerDownloadTools(server, client, new InlineDownloadIO());
      registerWriteTools(server, client);
    });

    try {
      const names = (await harness.listTools()).map((t) => t.name).sort();
      expect(names).toEqual(
        [
          'artsonia_download_artwork',
          'artsonia_get_activity',
          'artsonia_get_artwork',
          'artsonia_get_awards',
          'artsonia_get_fans',
          'artsonia_get_feedback',
          'artsonia_get_portfolio',
          'artsonia_get_profile',
          'artsonia_healthcheck',
          'artsonia_invite_fan',
          'artsonia_list_comments',
          'artsonia_list_students',
          'artsonia_mark_feedback_read',
          'artsonia_post_comment',
          'artsonia_set_notifications',
        ].sort(),
      );
      expect(names.length).toBe(15);
    } finally {
      await harness.close();
    }
  });
});
