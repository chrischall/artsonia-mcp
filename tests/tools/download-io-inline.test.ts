import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { registerDownloadTools } from '../../src/tools/download.js';
import { InlineDownloadIO, MAX_INLINE_BYTES } from '../../src/tools/download-io-inline.js';
import { NodeDownloadIO } from '../../src/tools/download-io.js';
import { tmpdir } from 'node:os';
import { client } from '../../src/client.js';
import { ACCEPT, createTestHarness } from '../helpers.js';

// The base64 of a buffer, for asserting image blocks carry the right bytes.
const b64 = (s: string) => Buffer.from(s).toString('base64');

describe('InlineDownloadIO', () => {
  it('surfaces .jpg writes as base64 image blocks and drops JSON sidecar/index writes', async () => {
    const io = new InlineDownloadIO();
    await io.writeFile('/x/a.jpg', Buffer.from('AAAA'));
    await io.writeFile('/x/a.json', Buffer.from('{"k":1}')); // sidecar — nowhere to go
    await io.writeFile('/x/index.json', Buffer.from('[]')); // manifest — nowhere to go
    const out = io.extraContent();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'image', mimeType: 'image/jpeg', data: b64('AAAA') });
  });

  it('drains on read: each extraContent() returns only the writes since the last read', async () => {
    const io = new InlineDownloadIO();
    await io.writeFile('/x/a.jpg', Buffer.from('a'));
    expect(io.extraContent().map((b) => (b as { data: string }).data)).toEqual([b64('a')]);
    // A second invocation must NOT re-emit the first call's image (the instance
    // is shared for the whole MCP session).
    await io.writeFile('/x/b.jpg', Buffer.from('b'));
    expect(io.extraContent().map((b) => (b as { data: string }).data)).toEqual([b64('b')]);
    // Nothing written since the last drain → empty.
    expect(io.extraContent()).toEqual([]);
  });

  it('caps cumulative inline bytes and reports the omitted images in a text warning block', async () => {
    const io = new InlineDownloadIO(10); // 10-byte cap
    await io.writeFile('/x/a.jpg', Buffer.alloc(6)); // fits (6 <= 10)
    await io.writeFile('/x/b.jpg', Buffer.alloc(6)); // 6 + 6 > 10 → omitted
    const out = io.extraContent();
    const images = out.filter((b) => b.type === 'image');
    const notes = out.filter((b) => b.type === 'text');
    expect(images).toHaveLength(1);
    expect(notes).toHaveLength(1);
    expect((notes[0] as { text: string }).text).toMatch(/omitted/i);
    // Counters reset after the drain — a fresh invocation starts from zero.
    await io.writeFile('/x/c.jpg', Buffer.alloc(6));
    expect(io.extraContent().filter((b) => b.type === 'image')).toHaveLength(1);
  });

  // The tool needs to know WHICH images were dropped, so it can list them as
  // omitted rather than downloaded. writeFile says so per write.
  it("tells the caller which writes were omitted: 'omitted' over the cap, nothing otherwise", async () => {
    const io = new InlineDownloadIO(10);
    expect(await io.writeFile('/x/a.jpg', Buffer.alloc(6))).toBeUndefined();
    expect(await io.writeFile('/x/b.jpg', Buffer.alloc(6))).toBe('omitted');
    expect(await io.writeFile('/x/meta.json', Buffer.alloc(60))).toBeUndefined(); // sidecars are never "omitted images"
  });

  // mcp-host (the hosted runtime behind claude.ai) replaces any single child
  // result over 14 MiB of serialized JSON-RPC with a generic "result too large"
  // error (CHILD_RESULT_MAX_BYTES, chrischall/mcp-host#952). The default cap must
  // keep a maximal inline result under that, so our own clearer note fires first.
  const HOST_RESULT_MAX_BYTES = 14 * 1024 * 1024;
  const MIB = 1024 * 1024;

  it('defaults the inline cap to 10 MiB raw', () => {
    expect(MAX_INLINE_BYTES).toBe(10 * MIB);
  });

  it('inlines a payload of exactly 10 MiB and keeps the serialized result under the 14 MiB host limit', async () => {
    const io = new InlineDownloadIO();
    await io.writeFile('/x/a.jpg', Buffer.alloc(6 * MIB));
    await io.writeFile('/x/b.jpg', Buffer.alloc(4 * MIB)); // cumulative = exactly 10 MiB
    const out = io.extraContent();
    expect(out.filter((b) => b.type === 'image')).toHaveLength(2);
    expect(out.filter((b) => b.type === 'text')).toHaveLength(0);
    const rpc = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: out } });
    expect(Buffer.byteLength(rpc)).toBeLessThan(HOST_RESULT_MAX_BYTES);
  });

  it('refuses a payload just over 10 MiB with its own note naming the narrower pulls', async () => {
    const io = new InlineDownloadIO();
    await io.writeFile('/x/a.jpg', Buffer.alloc(10 * MIB + 1));
    const out = io.extraContent();
    expect(out.filter((b) => b.type === 'image')).toHaveLength(0);
    const notes = out.filter((b) => b.type === 'text') as { text: string }[];
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toMatch(/10 MiB/);
    // Tells the model what to do instead, using the tool's real parameters.
    for (const param of ['limit', 'resolution', 'project', 'grade']) {
      expect(notes[0].text).toContain(`\`${param}\``);
    }
  });

  it('never touches the filesystem: mkdirp/setMtime are no-ops and exists() is always false', async () => {
    const io = new InlineDownloadIO();
    await expect(io.mkdirp('/nope/does/not/exist')).resolves.toBeUndefined();
    await expect(io.setMtime('/nope/a.jpg', new Date())).resolves.toBeUndefined();
    // Always false ⇒ `skip_existing` never skips (nothing the caller can reach
    // persists between calls), even for a path that really does exist here.
    expect(io.exists(import.meta.filename)).toBe(false);
  });

  it('persistsFiles is false (drives the honest omission of index_file/metadata_count)', () => {
    expect(new InlineDownloadIO().persistsFiles).toBe(false);
  });
});

describe('NodeDownloadIO', () => {
  it('persistsFiles is true', () => {
    expect(new NodeDownloadIO([tmpdir()]).persistsFiles).toBe(true);
  });
});

describe('artsonia_download_artwork on the inline IO', () => {
  const mockFetchHtml = vi.spyOn(client, 'fetchHtml');
  const mockFetch = vi.spyOn(globalThis, 'fetch');
  // Two artworks, newest-first.
  const PORTFOLIO = `<div class="grid">
    <div class="grid-item"><div class="grid-item-art"><a href="/museum/art.asp?id=200"><div class="genthumb"></div></a></div></div>
    <div class="grid-item"><div class="grid-item-art"><a href="/museum/art.asp?id=100"><div class="genthumb"></div></a></div></div>
  </div>`;
  let harness: Awaited<ReturnType<typeof createTestHarness>>;

  beforeEach(async () => {
    mockFetchHtml.mockReset();
    mockFetch.mockReset();
    mockFetchHtml.mockImplementation(((p: string) => Promise.resolve(p.includes('portfolio') ? PORTFOLIO : '')) as never);
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(new Uint8Array(1000), {
          status: 200,
          headers: { 'content-type': 'image/jpeg', 'content-length': '1000' },
        }),
      ),
    );
  });
  afterAll(async () => { if (harness) await harness.close(); });

  const imageBlocks = (res: any) => res.content.filter((c: any) => c.type === 'image');
  const summary = (res: any) => JSON.parse(res.content[0].text);

  it('does not leak a prior invocation\'s images into a later result (drain-on-read)', async () => {
    const io = new InlineDownloadIO();
    harness = await createTestHarness((s) => registerDownloadTools(s, client, () => io), ACCEPT);
    const first = await harness.callTool('artsonia_download_artwork', {
      artist_id: '1', dest: '/tmp/x', filename_template: '{artwork_id}',
    });
    expect(imageBlocks(first)).toHaveLength(2);
    // Second call downloads only 1 → its result must carry exactly 1 image block,
    // NOT 3 (the 2 leaked from the first call + its own).
    const second = await harness.callTool('artsonia_download_artwork', {
      artist_id: '1', dest: '/tmp/x', filename_template: '{artwork_id}', limit: 1,
    });
    expect(imageBlocks(second)).toHaveLength(1);
    await harness.close();
  });

  it('omits index_file / metadata_count on the inline path (those files are never persisted)', async () => {
    const io = new InlineDownloadIO();
    harness = await createTestHarness((s) => registerDownloadTools(s, client, () => io), ACCEPT);
    const res = await harness.callTool('artsonia_download_artwork', {
      artist_id: '1', dest: '/tmp/x', filename_template: '{artwork_id}',
      write_index: true, write_metadata: true,
    });
    const out = summary(res);
    expect(out.downloaded_count).toBe(2);
    expect(out.index_file).toBeUndefined();
    expect(out.metadata_count).toBeUndefined();
    await harness.close();
  });
  it('gives each invocation its own IO, so concurrent calls cannot drain each other', async () => {
    // The regression: a single shared instance meant two in-flight calls
    // interleaved and one result drained the other's images.
    const built: InlineDownloadIO[] = [];
    harness = await createTestHarness((s) =>
      registerDownloadTools(s, client, () => {
        const io = new InlineDownloadIO();
        built.push(io);
        return io;
      }),
      ACCEPT,
    );
    const [a, b] = await Promise.all([
      harness.callTool('artsonia_download_artwork', {
        artist_id: '1', dest: '/tmp/x', filename_template: '{artwork_id}',
      }),
      harness.callTool('artsonia_download_artwork', {
        artist_id: '1', dest: '/tmp/x', filename_template: '{artwork_id}', limit: 1,
      }),
    ]);
    // One IO per handler invocation (the confirm round trip re-invokes the
    // handler, so each call may build more than one) — never a shared instance.
    expect(built.length).toBeGreaterThanOrEqual(2);
    expect(new Set(built).size).toBe(built.length);
    // Each result carries exactly its own images, whichever order they finished in.
    expect([imageBlocks(a).length, imageBlocks(b).length].sort()).toEqual([1, 2]);
    await harness.close();
  });

  it('omits dest and per-item file paths when nothing was written to disk', async () => {
    // Reporting a path the caller cannot reach reads as "your files are there".
    const io = new InlineDownloadIO();
    harness = await createTestHarness((s) => registerDownloadTools(s, client, () => io), ACCEPT);
    const res = await harness.callTool('artsonia_download_artwork', {
      artist_id: '1', dest: '/tmp/x', filename_template: '{artwork_id}',
    });
    const out = summary(res);
    expect(out.dest).toBeUndefined();
    expect(out.downloaded).toHaveLength(2);
    for (const d of out.downloaded) expect(d.file).toBeUndefined();
    await harness.close();
  });
});
