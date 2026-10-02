// chrischall/fleet-audit#985 (and #365): artsonia_download_artwork's `dest` is a
// model-chosen folder. On the disk IO it is confined to download roots
// (ARTSONIA_OUTPUT_DIR, else ~/Downloads + ~/Pictures locally, else
// $MCP_DATA_DIR/downloads when hosted) via mcp-utils resolveOutputDir /
// writeFileSafe with allowedRoots. The inline IO touches no disk, so `dest` is
// only a label there and stays unconfined.
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, symlinkSync, readdirSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { registerDownloadTools } from '../../src/tools/download.js';
import { NodeDownloadIO } from '../../src/tools/download-io.js';
import { InlineDownloadIO } from '../../src/tools/download-io-inline.js';
import { downloadRoots, makeDownloadIO } from '../../src/tools/make-download-io.js';
import { client } from '../../src/client.js';
import { ACCEPT, createTestHarness, parseResult, phaseOne, restoreConfirmEnvAfterEach } from '../helpers.js';

const PORTFOLIO = `<div class="grid">
  <div class="grid-item"><div class="grid-item-art"><a href="/museum/art.asp?id=100"><div class="genthumb"></div></a></div></div>
</div>`;
const mockFetchHtml = vi.spyOn(client, 'fetchHtml');
const mockFetch = vi.spyOn(globalThis, 'fetch');

let base: string; // a temp tree standing in for the filesystem
let root: string; // the one allowed download root inside it
const harnesses: Array<{ close(): Promise<void> }> = [];
beforeEach(() => {
  mockFetchHtml.mockReset();
  mockFetch.mockReset();
  mockFetchHtml.mockResolvedValue(PORTFOLIO as never);
  mockFetch.mockImplementation(() =>
    Promise.resolve(new Response(new Uint8Array(10), { status: 200, headers: { 'content-length': '10' } })),
  );
  base = realpathSync(mkdtempSync(join(tmpdir(), 'artsonia-confine-')));
  root = join(base, 'root');
  mkdirSync(root);
});
afterEach(() => rmSync(base, { recursive: true, force: true }));
afterAll(async () => { for (const h of harnesses) await h.close(); });
restoreConfirmEnvAfterEach();

async function tool(io: () => NodeDownloadIO | InlineDownloadIO, opts?: typeof ACCEPT) {
  const h = await createTestHarness((s) => registerDownloadTools(s, client, io), opts);
  harnesses.push(h);
  return h;
}
const args = (dest: string) => ({ artist_id: '1', dest, filename_template: '{artwork_id}' });

describe('downloadRoots', () => {
  it('ARTSONIA_OUTPUT_DIR wins, as a path-delimiter list (blanks dropped)', () => {
    expect(downloadRoots({ ARTSONIA_OUTPUT_DIR: ` /a ${delimiter}${delimiter} ~/b `, MCP_DATA_DIR: '/data' })).toEqual(['/a', '~/b']);
  });
  it('locally defaults to ~/Downloads and ~/Pictures', () => {
    expect(downloadRoots({})).toEqual(['~/Downloads', '~/Pictures']);
  });
  it('hosted (MCP_DATA_DIR set) defaults to $MCP_DATA_DIR/downloads — never the runner home, nor the data dir itself', () => {
    expect(downloadRoots({ MCP_DATA_DIR: '/data' })).toEqual([join('/data', 'downloads')]);
  });
  it('a blank or delimiter-only ARTSONIA_OUTPUT_DIR still confines (falls back to the defaults)', () => {
    expect(downloadRoots({ ARTSONIA_OUTPUT_DIR: '  ' })).toEqual(['~/Downloads', '~/Pictures']);
    expect(downloadRoots({ ARTSONIA_OUTPUT_DIR: delimiter })).toEqual(['~/Downloads', '~/Pictures']);
  });
  it('makeDownloadIO gives the disk IO those roots; the inline IO has none', () => {
    const saved = { ...process.env };
    try {
      delete process.env.ARTSONIA_INLINE_DOWNLOADS;
      process.env.ARTSONIA_OUTPUT_DIR = '/only/here';
      expect(makeDownloadIO().allowedRoots).toEqual(['/only/here']);
      process.env.ARTSONIA_INLINE_DOWNLOADS = '1';
      expect(makeDownloadIO().allowedRoots).toBeUndefined();
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });
});

describe('NodeDownloadIO confinement', () => {
  it('refuses to create a folder outside its roots', async () => {
    const io = new NodeDownloadIO([root]);
    await expect(io.mkdirp(join(base, 'elsewhere'))).rejects.toThrow(/outside/i);
    expect(existsSync(join(base, 'elsewhere'))).toBe(false);
  });
  it('refuses to write a file outside its roots', async () => {
    const io = new NodeDownloadIO([root]);
    await expect(io.writeFile(join(base, 'x.jpg'), Buffer.from('x'))).rejects.toThrow();
    expect(existsSync(join(base, 'x.jpg'))).toBe(false);
  });
  it('never writes through a symlink planted at the target name', async () => {
    const io = new NodeDownloadIO([root]);
    const victim = join(base, 'victim.txt');
    writeFileSync(victim, 'untouched');
    symlinkSync(victim, join(root, '100.jpg'));
    await expect(io.writeFile(join(root, '100.jpg'), Buffer.from('evil'))).rejects.toThrow();
    expect(readFileSync(victim, 'utf8')).toBe('untouched');
  });
  it('still overwrites a regular file in the root (skip_existing:false, index.json re-runs)', async () => {
    const io = new NodeDownloadIO([root]);
    writeFileSync(join(root, 'index.json'), 'old');
    await io.writeFile(join(root, 'index.json'), Buffer.from('new'));
    expect(readFileSync(join(root, 'index.json'), 'utf8')).toBe('new');
  });
});

describe('artsonia_download_artwork — dest confinement (disk IO)', () => {
  it('refuses a dest outside the roots before any network call, naming ARTSONIA_OUTPUT_DIR', async () => {
    const h = await tool(() => new NodeDownloadIO([root]));
    const res = await h.callTool('artsonia_download_artwork', args(join(base, 'outside')));
    expect(res.isError).toBe(true);
    const text = (res.content as Array<{ text: string }>)[0].text;
    expect(text).toMatch(/ARTSONIA_OUTPUT_DIR/);
    expect(text).toContain(root);
    expect(mockFetchHtml).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(existsSync(join(base, 'outside'))).toBe(false);
  });

  it('refuses a ../ escape out of a root', async () => {
    const h = await tool(() => new NodeDownloadIO([root]));
    const res = await h.callTool('artsonia_download_artwork', args(join(root, '..', 'sibling')));
    expect(res.isError).toBe(true);
    expect(existsSync(join(base, 'sibling'))).toBe(false);
  });

  it('refuses a name-prefix sibling of a root (root-evil)', async () => {
    const h = await tool(() => new NodeDownloadIO([root]));
    const res = await h.callTool('artsonia_download_artwork', args(`${root}-evil`));
    expect(res.isError).toBe(true);
  });

  it('refuses a symlinked folder inside a root that points out of it', async () => {
    mkdirSync(join(base, 'out'));
    symlinkSync(join(base, 'out'), join(root, 'link'));
    const h = await tool(() => new NodeDownloadIO([root]), ACCEPT);
    const res = await h.callTool('artsonia_download_artwork', args(join(root, 'link')));
    expect(res.isError).toBe(true);
    expect(readdirSync(join(base, 'out'))).toHaveLength(0);
  });

  it('accepts a new subfolder of a root: the preview creates nothing, the confirmed run creates it', async () => {
    const dest = join(root, 'Finn', 'art');
    const h = await tool(() => new NodeDownloadIO([root]));
    const p1 = await phaseOne(h, 'artsonia_download_artwork', args(dest));
    expect(existsSync(join(root, 'Finn'))).toBe(false);
    const out = parseResult(await h.callTool('artsonia_download_artwork', { ...args(dest), confirmToken: p1.confirmToken }));
    expect(out.downloaded_count).toBe(1);
    expect(readdirSync(dest)).toEqual(['100.jpg']);
  });
});

describe('artsonia_download_artwork — inline IO is unconfined (no disk)', () => {
  it('accepts any dest and creates nothing', async () => {
    const h = await tool(() => new InlineDownloadIO(), ACCEPT);
    const dest = join(base, 'anywhere');
    const out = parseResult(await h.callTool('artsonia_download_artwork', args(dest)));
    expect(out.downloaded_count).toBe(1);
    expect(existsSync(dest)).toBe(false);
  });
});
