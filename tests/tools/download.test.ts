import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { registerDownloadTools } from '../../src/tools/download.js';
import { client } from '../../src/client.js';
import { createTestHarness } from '../helpers.js';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mockFetchHtml = vi.spyOn(client, 'fetchHtml').mockResolvedValue('' as never);
const mockFetch = vi.spyOn(globalThis, 'fetch');

// A portfolio with three artworks (newest-first), no headers.
const PORTFOLIO = `<div class="grid">
  <div class="grid-item"><div class="grid-item-art"><a href="/museum/art.asp?id=300"><div class="genthumb"></div></a></div></div>
  <div class="grid-item"><div class="grid-item-art"><a href="/museum/art.asp?id=200"><div class="genthumb"></div></a></div></div>
  <div class="grid-item"><div class="grid-item-art"><a href="/museum/art.asp?id=100"><div class="genthumb"></div></a></div></div>
</div>`;
const detail = (id: string, grade: string, project: string) =>
  `<html><head><title>Artsonia Art Museum :: "Piece ${id}" by Kid1</title></head><body>
   <div class="textNormal">created by Kid1 in Grade ${grade} at School</div>
   <div>from school project "${project}"</div></body></html>`;

function imageResponse(bytes = 5) {
  return new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-type': 'image/jpeg' } });
}

let harness: Awaited<ReturnType<typeof createTestHarness>>;
let dir: string;
beforeEach(() => { mockFetchHtml.mockReset(); mockFetch.mockReset(); dir = mkdtempSync(join(tmpdir(), 'artsonia-dl-')); });
afterAll(async () => { if (harness) await harness.close(); });
const parse = (res: any) => JSON.parse(res.content[0].text);

describe('artsonia_download_artwork', () => {
  it('setup + registers the tool', async () => {
    harness = await createTestHarness((s) => registerDownloadTools(s, client));
    expect((await harness.listTools()).map((t) => t.name)).toContain('artsonia_download_artwork');
  });

  it('dry run (no confirm) lists matches and downloads nothing', async () => {
    mockFetchHtml.mockResolvedValue(PORTFOLIO as never);
    const out = parse(await harness.callTool('artsonia_download_artwork', { artist_id: '13447141', dest: dir }));
    expect(out.preview).toBe(true);
    expect(out.count).toBe(3);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it('downloads all images to dest with confirm', async () => {
    mockFetchHtml.mockResolvedValue(PORTFOLIO as never);
    mockFetch.mockImplementation(() => Promise.resolve(imageResponse()));
    const out = parse(await harness.callTool('artsonia_download_artwork', { artist_id: '13447141', dest: dir, confirm: true }));
    expect(out.downloaded_count).toBe(3);
    // fetched the full-res CDN url for each id
    expect(mockFetch).toHaveBeenCalledWith('https://images.artsonia.com/art/full/300.jpg');
    expect(existsSync(join(dir, '300.jpg'))).toBe(true);
    expect(existsSync(join(dir, '100.jpg'))).toBe(true);
    expect(readdirSync(dir).sort()).toEqual(['100.jpg', '200.jpg', '300.jpg']);
  });

  it('most-recent-N keeps the first N (newest) without detail fetches', async () => {
    mockFetchHtml.mockResolvedValue(PORTFOLIO as never);
    mockFetch.mockImplementation(() => Promise.resolve(imageResponse()));
    const out = parse(await harness.callTool('artsonia_download_artwork', { artist_id: '1', dest: dir, limit: 2, confirm: true }));
    expect(out.downloaded_count).toBe(2);
    expect(readdirSync(dir).sort()).toEqual(['200.jpg', '300.jpg']); // newest two (300, 200)
    // limit-only must NOT fetch detail pages — only the portfolio
    expect(mockFetchHtml).toHaveBeenCalledTimes(1);
  });

  it('project filter fetches details and keeps only matches', async () => {
    mockFetchHtml.mockImplementation(((path: string) => {
      if (path.includes('portfolio.asp')) return Promise.resolve(PORTFOLIO);
      if (path.includes('id=300')) return Promise.resolve(detail('300', '6', 'Silhouette Still Life'));
      if (path.includes('id=200')) return Promise.resolve(detail('200', '6', 'Clay Pots'));
      return Promise.resolve(detail('100', '5', 'Silhouette Warmup'));
    }) as never);
    mockFetch.mockImplementation(() => Promise.resolve(imageResponse()));
    const out = parse(await harness.callTool('artsonia_download_artwork', { artist_id: '1', dest: dir, project: 'silhouette', confirm: true }));
    expect(out.downloaded_count).toBe(2);
    expect(readdirSync(dir).sort()).toEqual(['100.jpg', '300.jpg']); // 300 + 100 match "silhouette"
  });

  it('resolution flows through to the CDN url', async () => {
    mockFetchHtml.mockResolvedValue(PORTFOLIO as never);
    mockFetch.mockImplementation(() => Promise.resolve(imageResponse()));
    await harness.callTool('artsonia_download_artwork', { artist_id: '1', dest: dir, limit: 1, resolution: 'large', confirm: true });
    expect(mockFetch).toHaveBeenCalledWith('https://images.artsonia.com/art/large/300.jpg');
  });
});
