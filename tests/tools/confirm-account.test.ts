// Confirm tokens bind the signed-in account (chrischall/fleet-audit#986): under
// a shared MCP_CONFIRM_SECRET, a token minted by one Artsonia account's server
// must not verify in another account's server for the same target + payload.
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/server';
import { createDirectClient, ArtsoniaClient } from '../../src/client.js';
import { AuthManager } from '../../src/auth.js';
import { registerWriteTools } from '../../src/tools/writes.js';
import { registerFeedbackTools } from '../../src/tools/feedback.js';
import { registerDownloadTools, type DownloadIO } from '../../src/tools/download.js';
import { createTestHarness, parseResult as parse, phaseOne, restoreConfirmEnvAfterEach } from '../helpers.js';

restoreConfirmEnvAfterEach();
afterEach(() => vi.unstubAllGlobals());

const OK = { status: 302, body: '', url: 'https://www.artsonia.com/members/', setCookie: [] as string[], location: '/members/' };
const PORTFOLIO = '<div class="artwork"><a href="/museum/art.asp?id=111"><img src="x.jpg"></a></div>';

const inlineIO = (): DownloadIO => ({
  persistsFiles: false,
  mkdirp: async () => {},
  exists: () => false,
  writeFile: async () => {},
  setMtime: async () => {},
  extraContent: () => [],
});

function stubbed(username: string) {
  const c = createDirectClient({ username, password: 'pw' });
  const write = vi.spyOn(c, 'write').mockResolvedValue(OK as never);
  vi.spyOn(c, 'fetchHtml').mockImplementation(async (path: string) => (path.startsWith('/artists/portfolio') ? PORTFOLIO : ''));
  return { c, write };
}

const CASES: Array<{ name: string; args: Record<string, unknown>; register: (s: McpServer, c: ArtsoniaClient) => void }> = [
  { name: 'artsonia_post_comment', args: { artist_id: '1', artwork_id: '2', comment: 'Hi' }, register: registerWriteTools },
  { name: 'artsonia_invite_fan', args: { artist_id: '1', first_name: 'A', last_name: 'B', email: 'a@example.com', relationship_id: '3' }, register: registerWriteTools },
  { name: 'artsonia_mark_feedback_read', args: { artist_id: '1' }, register: registerFeedbackTools },
  {
    name: 'artsonia_download_artwork',
    args: { artist_id: '1', dest: 'label', filename_template: '{artwork_id}' },
    register: (s, c) => registerDownloadTools(s, c, inlineIO),
  },
];

describe('confirm tokens are bound to the signed-in account', () => {
  for (const { name, args, register } of CASES) {
    it(`${name}: a token minted for one account is refused for another`, async () => {
      process.env.MCP_CONFIRM_SECRET = 'shared-secret-across-tenants-0123456789';
      vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
      const alice = stubbed('alice@example.com');
      const bob = stubbed('bob@example.com');
      const ha = await createTestHarness((s) => register(s, alice.c));
      const hb = await createTestHarness((s) => register(s, bob.c));
      try {
        const { confirmToken } = await phaseOne(ha, name, args);
        const res = await hb.callTool(name, { ...args, confirmToken });
        expect(res.isError).toBe(true);
        expect(parse(res).error).toBe('TOKEN_INVALID');
        expect(bob.write).not.toHaveBeenCalled();
      } finally {
        await ha.close();
        await hb.close();
      }
    });
  }

  it('the account is the username, normalised (case + whitespace do not matter)', () => {
    const t = { request: vi.fn(), usesBrowserSession: false } as never;
    expect(new ArtsoniaClient({ transport: t, auth: new AuthManager(t, { username: ' Alice@Example.com ', password: 'pw' }) }).confirmAccount)
      .toBe('alice@example.com');
  });

  it('browser-session mode binds no account (the server holds no username)', () => {
    const t = { request: vi.fn(), usesBrowserSession: true } as never;
    expect(new ArtsoniaClient({ transport: t, auth: new AuthManager(t, { username: 'alice', password: 'pw' }) }).confirmAccount)
      .toBeUndefined();
  });

  it('no username configured binds no account', () => {
    const prev = process.env.ARTSONIA_USERNAME;
    delete process.env.ARTSONIA_USERNAME;
    try {
      const t = { request: vi.fn(), usesBrowserSession: false } as never;
      expect(new ArtsoniaClient({ transport: t, auth: new AuthManager(t, {}) }).confirmAccount).toBeUndefined();
    } finally {
      if (prev !== undefined) process.env.ARTSONIA_USERNAME = prev;
    }
  });
});
