import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerDownloadTools } from '../../src/tools/download.js';
import { InlineDownloadIO } from '../../src/tools/download-io-inline.js';
import { makeDownloadIO } from '../../src/tools/make-download-io.js';
import { client } from '../../src/client.js';
import { createTestHarness } from '../helpers.js';

// Nothing a pull fetched may vanish: an image is delivered inline, through a
// signed link (hosted, with a blob store), or reported BY NAME with the reason.

const BASE = 'https://host.example/b/reg_0123456789abcdef01234567';
const HOSTED = { MCP_BLOB_BASE_URL: BASE, MCP_BLOB_SIGNING_KEY: 'a2V5', MCP_DATA_DIR: '/data' };
const JPEG = (n: number) => {
  const b = Buffer.alloc(n);
  b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; // JPEG magic, so the sniff agrees
  return b;
};

type Put = { url: string; type: string | null; bytes: Buffer };
let puts: Put[];
let putStatus: number;
const mockFetch = vi.spyOn(globalThis, 'fetch');
const mockFetchHtml = vi.spyOn(client, 'fetchHtml');
let imageSize: number;

const PORTFOLIO = `<div class="grid">
  <div class="grid-item"><div class="grid-item-art"><a href="/museum/art.asp?id=300"><div class="genthumb"></div></a></div></div>
  <div class="grid-item"><div class="grid-item-art"><a href="/museum/art.asp?id=200"><div class="genthumb"></div></a></div></div>
  <div class="grid-item"><div class="grid-item-art"><a href="/museum/art.asp?id=100"><div class="genthumb"></div></a></div></div>
</div>`;
const detail = (title: string) =>
  `<html><head><title>Artsonia Art Museum :: "${title}" by Student</title></head><body>
   <div class="textNormal">created by Student in Grade 4 at School</div>
   <div>from school project "Project"</div></body></html>`;

beforeEach(() => {
  puts = [];
  putStatus = 201;
  imageSize = 20_000;
  mockFetch.mockReset();
  mockFetch.mockImplementation((async (url: string, init?: RequestInit) => {
    if (String(url).startsWith(BASE)) {
      puts.push({
        url: String(url),
        type: new Headers(init?.headers).get('content-type'),
        bytes: Buffer.from(init!.body as Uint8Array),
      });
      return new Response(null, { status: putStatus });
    }
    return new Response(new Uint8Array(JPEG(imageSize)), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  }) as never);
  mockFetchHtml.mockReset();
  mockFetchHtml.mockImplementation(((p: string) => {
    if (p.includes('portfolio')) return Promise.resolve(PORTFOLIO);
    const id = p.match(/id=(\d+)/)?.[1];
    return Promise.resolve(id ? detail(`Piece ${id}`) : '');
  }) as never);
});
afterEach(() => {
  for (const k of Object.keys(HOSTED)) delete process.env[k];
  delete process.env.ARTSONIA_INLINE_DOWNLOADS;
});

describe('InlineDownloadIO — delivery ladder', () => {
  it('no blob store: an over-cap image is refused with a reason naming the cap and the narrower pulls', async () => {
    const io = new InlineDownloadIO(10, { env: {} });
    expect(await io.writeFile('/x/a.jpg', JPEG(6), 'a.jpg')).toBeUndefined();
    const refused = await io.writeFile('/x/b.jpg', JPEG(6), 'b.jpg');
    expect(refused).toEqual({ omitted: expect.stringMatching(/inline limit/) });
    expect(refused!.omitted).toMatch(/no blob store/);
    const out = await io.finish();
    const note = out.content.find((b) => b.type === 'text') as { text: string };
    expect(note.text).toContain('b.jpg');
    for (const p of ['limit', 'resolution', 'project', 'grade']) expect(note.text).toContain(`\`${p}\``);
  });

  it('with a blob store: overflow images go into ONE zip behind a signed link, never dropped', async () => {
    const io = new InlineDownloadIO(10, { env: HOSTED });
    expect(await io.writeFile('/d/a.jpg', JPEG(6), 'a.jpg')).toBeUndefined();
    expect(await io.writeFile('/d/b.jpg', JPEG(6), 'sub/b.jpg')).toBeUndefined();
    expect(await io.writeFile('/d/c.jpg', JPEG(6), 'c.jpg')).toBeUndefined();
    const out = await io.finish();
    expect(out.content.filter((b) => b.type === 'image')).toHaveLength(1);
    expect(out.via?.get('/d/a.jpg')).toEqual({ via: 'inline' });
    expect(out.via?.get('/d/b.jpg')).toEqual({ via: 'archive', name: 'sub/b.jpg' });
    expect(out.archive).toMatchObject({ file_count: 2, bytes: 12 });
    expect(out.archive!.url).toMatch(new RegExp(`^${BASE}/exp/[^/]+/part-0001\\.zip\\?`));
    expect(puts).toHaveLength(1);
    expect(puts[0]!.type).toBe('application/zip');
    expect(puts[0]!.bytes.includes(Buffer.from('sub/b.jpg'))).toBe(true);
    expect(puts[0]!.bytes.includes(Buffer.from('c.jpg'))).toBe(true);
    expect(out.undelivered?.size ?? 0).toBe(0);
  });

  it('with a blob store: past the archive limit an image is refused by reason, not dropped', async () => {
    const io = new InlineDownloadIO(10, { env: HOSTED, archiveMaxBytes: 8 });
    await io.writeFile('/d/a.jpg', JPEG(6), 'a.jpg'); // inline
    await io.writeFile('/d/b.jpg', JPEG(6), 'b.jpg'); // archive
    const refused = await io.writeFile('/d/c.jpg', JPEG(6), 'c.jpg');
    expect(refused?.omitted).toMatch(/archive/);
  });

  it('a failed archive upload reports every image in it as undelivered, with the reason', async () => {
    putStatus = 500;
    const io = new InlineDownloadIO(10, { env: HOSTED });
    await io.writeFile('/d/a.jpg', JPEG(6), 'a.jpg');
    await io.writeFile('/d/b.jpg', JPEG(6), 'b.jpg');
    await io.writeFile('/d/c.jpg', JPEG(6), 'c.jpg');
    const out = await io.finish();
    expect(out.archive).toBeUndefined();
    expect([...out.undelivered!.keys()].sort()).toEqual(['/d/b.jpg', '/d/c.jpg']);
    expect(out.undelivered!.get('/d/b.jpg')).toMatch(/upload/i);
    const note = out.content.find((b) => b.type === 'text') as { text: string };
    expect(note.text).toContain('b.jpg');
  });

  it('a single image goes through deliverFile: inline when it fits', async () => {
    const io = new InlineDownloadIO(10, { env: HOSTED });
    await io.writeFile('/d/a.jpg', JPEG(6), 'a.jpg');
    const out = await io.finish();
    expect(out.content).toEqual([{ type: 'image', mimeType: 'image/jpeg', data: JPEG(6).toString('base64') }]);
    expect(puts).toHaveLength(0);
  });

  it('a single over-cap image is delivered as a signed link when hosted (not zipped, never disk)', async () => {
    const io = new InlineDownloadIO(10, { env: HOSTED });
    expect(await io.writeFile('/d/big.jpg', JPEG(30), 'big.jpg')).toBeUndefined();
    const out = await io.finish();
    expect(out.content.filter((b) => b.type === 'image')).toHaveLength(0);
    const v = out.via!.get('/d/big.jpg') as { via: string; url: string; expires_at: string };
    expect(v.via).toBe('link');
    expect(v.url).toMatch(new RegExp(`^${BASE}/artwork/[0-9a-f-]{36}/big\\.jpg\\?`));
    expect(v.expires_at).toMatch(/Z$/);
    expect(puts[0]!.type).toBe('image/jpeg');
  });

  it('a single over-cap image with no blob store is refused by reason', async () => {
    const io = new InlineDownloadIO(10, { env: {} });
    const refused = await io.writeFile('/d/big.jpg', JPEG(30), 'big.jpg');
    expect(refused?.omitted).toMatch(/inline limit/);
  });

  it('finish() drains: a second call starts empty', async () => {
    const io = new InlineDownloadIO(10, { env: {} });
    await io.writeFile('/d/a.jpg', JPEG(6), 'a.jpg');
    await io.finish();
    expect((await io.finish()).content).toEqual([]);
  });
});

describe('makeDownloadIO — hosted never writes disk', () => {
  it('local, no flag: the disk IO (unchanged)', () => {
    expect(makeDownloadIO({}).constructor.name).toBe('NodeDownloadIO');
  });
  it('hosted (MCP_DATA_DIR) without the inline flag: the inline/link IO, not the runner disk', () => {
    const io = makeDownloadIO({ MCP_DATA_DIR: '/data' });
    expect(io.constructor.name).toBe('InlineDownloadIO');
    expect(io.persistsFiles).toBe(false);
  });
  it('hosted with a blob store: the inline/link IO', () => {
    expect(makeDownloadIO(HOSTED).constructor.name).toBe('InlineDownloadIO');
  });
});

describe('artsonia_download_artwork — nothing dropped silently', () => {
  const call = async (io: () => InlineDownloadIO, args: Record<string, unknown> = {}) => {
    const h = await createTestHarness((s) => registerDownloadTools(s, client, io));
    try {
      const res = await h.callTool('artsonia_download_artwork', { artist_id: '1', dest: '/tmp/x', ...args });
      return { res, out: JSON.parse((res.content[0] as { text: string }).text) };
    } finally { await h.close(); }
  };

  it('no blob store: each image over the cap is listed by name and title with the reason', async () => {
    const { out } = await call(() => new InlineDownloadIO(45_000, { env: {} }));
    expect(out.downloaded_count).toBe(2);
    expect(out.omitted_count).toBe(1);
    const [o] = out.omitted;
    expect(o.name).toMatch(/^Grade 4 - Project - Piece \d00 \(\d00\)\.jpg$/);
    expect(o.title).toMatch(/^Piece \d00$/);
    expect(o.reason).toMatch(/inline limit/);
    expect(o.bytes).toBe(20_000);
  });

  it('hosted bulk pull: overflow is delivered in one zip link; nothing is omitted', async () => {
    const { out, res } = await call(() => new InlineDownloadIO(45_000, { env: HOSTED }), { filename_template: '{artwork_id}' });
    expect(out.downloaded_count).toBe(3);
    expect(out).not.toHaveProperty('omitted');
    expect(out.archive).toMatchObject({ file_count: 1, bytes: 20_000 });
    expect(out.archive.url).toContain('/exp/');
    const vias = out.downloaded.map((d: { delivered_via: string }) => d.delivered_via).sort();
    expect(vias).toEqual(['archive', 'inline', 'inline']);
    expect(res.content.filter((b: { type: string }) => b.type === 'image')).toHaveLength(2);
    expect(out.total_bytes).toBe(60_000);
  });

  it('hosted, archive upload fails: those images move from downloaded to omitted, with the reason', async () => {
    putStatus = 503;
    const { out } = await call(() => new InlineDownloadIO(45_000, { env: HOSTED }), { filename_template: '{artwork_id}' });
    expect(out.downloaded_count).toBe(2);
    expect(out.omitted_count).toBe(1);
    expect(out.omitted[0].reason).toMatch(/upload/i);
    expect(out.omitted[0].name).toMatch(/^\d00\.jpg$/);
    expect(out.total_bytes).toBe(40_000);
    expect(out).not.toHaveProperty('archive');
  });

  it('hosted single over-cap image: one signed link on the downloaded entry', async () => {
    imageSize = 60_000;
    const { out } = await call(() => new InlineDownloadIO(45_000, { env: HOSTED }), { filename_template: '{artwork_id}', limit: 1 });
    expect(out.downloaded_count).toBe(1);
    expect(out.downloaded[0]).toMatchObject({ artwork_id: '300', delivered_via: 'link' });
    expect(out.downloaded[0].url).toContain('/artwork/');
    expect(out.downloaded[0].expires_at).toBeDefined();
  });

  it('failed fetches carry the title when it is known', async () => {
    mockFetch.mockImplementation((async () => new Response('nope', { status: 404 })) as never);
    const { out } = await call(() => new InlineDownloadIO(45_000, { env: {} }));
    expect(out.failed_count).toBe(3);
    expect(out.failed[0]).toMatchObject({ reason: 'HTTP 404', title: expect.stringMatching(/^Piece/) });
  });
});
