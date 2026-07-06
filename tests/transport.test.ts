import { describe, it, expect, afterEach } from 'vitest';
import { makeTransport } from '../src/transport.js';

// The env-selected transport switch. Instantiating the fetchproxy transport is
// side-effect free (the @chrischall/mcp-utils/fetchproxy adapter — and with it
// @fetchproxy/server — is lazy-imported only on the first request()), so this
// test never touches the bridge.
describe('makeTransport', () => {
  const saved = process.env.ARTSONIA_TRANSPORT;
  afterEach(() => {
    if (saved === undefined) delete process.env.ARTSONIA_TRANSPORT;
    else process.env.ARTSONIA_TRANSPORT = saved;
  });

  it('defaults to the direct fetch transport (server-owned session)', async () => {
    delete process.env.ARTSONIA_TRANSPORT;
    const t = await makeTransport();
    expect(t.constructor.name).toBe('FetchArtsoniaTransport');
    expect(t.usesBrowserSession).toBeFalsy();
  });

  it('selects the fetchproxy transport when ARTSONIA_TRANSPORT=fetchproxy', async () => {
    process.env.ARTSONIA_TRANSPORT = 'fetchproxy';
    const t = await makeTransport();
    expect(t.constructor.name).toBe('FetchproxyArtsoniaTransport');
    expect(t.usesBrowserSession).toBe(true);
  });
});
