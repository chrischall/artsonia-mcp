import { readEnvVar } from '@chrischall/mcp-utils';
import { AuthManager } from './auth.js';
import { makeTransport } from './make-transport.js';
import { ArtsoniaClient } from './client-core.js';

// Re-export the bridge-free client surface so existing importers
// (`import { ArtsoniaClient } from './client.js'`, the tool registrars' type
// imports, tests) keep working unchanged.
export { ArtsoniaClient, createDirectClient, type ArtsoniaClientOptions } from './client-core.js';

// The env-driven stdio singleton. Constructed here (not index.ts) so the
// deferred-config-error pattern holds: the server boots and answers tools/list
// even with no creds; the error surfaces on the first tool call. It uses
// `makeTransport()`, which honours `ARTSONIA_TRANSPORT` (direct fetch by
// default, or the fetchproxy browser-bridge fallback) — the reason this module
// (and NOT client-core.ts) carries the fetchproxy dependency, keeping it out
// of any graph that imports client-core.ts alone. The guarded `.env`
// load lives in client-core.ts and has already run by the time this executes.
const transport = await makeTransport();
export const client = new ArtsoniaClient({
  transport,
  auth: new AuthManager(transport, {
    username: readEnvVar('ARTSONIA_USERNAME'),
    password: readEnvVar('ARTSONIA_PASSWORD'),
  }),
});
