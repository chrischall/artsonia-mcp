import { readEnvVar } from '@chrischall/mcp-utils';
import type { ArtsoniaTransport } from './transport.js';

// Env-driven transport selector for the stdio server: `ARTSONIA_TRANSPORT`
// picks the direct node-fetch transport (default) or the fetchproxy
// browser-bridge fallback. This module is deliberately SEPARATE from
// `transport.ts` (the leaf) because it carries the `@fetchproxy/server` dynamic
// import: only the stdio singleton (`client.ts`) imports it, so a consumer that
// builds its per-user clients via `createDirectClient` (direct mode only) keeps
// the bridge out of its graph entirely.
export async function makeTransport(): Promise<ArtsoniaTransport> {
  const mode = readEnvVar('ARTSONIA_TRANSPORT') ?? 'fetch';
  if (mode === 'fetchproxy') {
    const { FetchproxyArtsoniaTransport } = await import('./transport-fetchproxy.js');
    return new FetchproxyArtsoniaTransport();
  }
  const { FetchArtsoniaTransport } = await import('./transport-fetch.js');
  return new FetchArtsoniaTransport();
}
