import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { registerDownloadTools, buildFilename } from '../../src/tools/download.js';
import { client } from '../../src/client.js';
import { createTestHarness } from '../helpers.js';
import { mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mockFetchHtml = vi.spyOn(client, 'fetchHtml').mockResolvedValue('' as never);
const mockFetch = vi.spyOn(globalThis, 'fetch');

// Portfolio: three artworks, newest-first.
const PORTFOLIO = `<div class="grid">
  <div class="grid-item"><div class="grid-item-art"><a href="/museum/art.asp?id=300"><div class="genthumb"></div></a></div></div>
  <div class="grid-item"><div class="grid-item-art"><a href="/museum/art.asp?id=200"><div class="genthumb"></div></a></div></div>
  <div class="grid-item"><div class="grid-item-art"><a href="/museum/art.asp?id=100"><div class="genthumb"></div></a></div></div>
</div>`;
const detail = (grade: string, project: string, title: string) =>
  `<html><head><title>Artsonia Art Museum :: "${title}" by Kid1</title></head><body>
   <div class="textNormal">created by Kid1 in Grade ${grade} at School</div>
   <div>from school project "${project}"</div></body></html>`;
const DETAILS: Record<string, string> = {
  '300': detail('6', 'Silhouette', 'My silhouette'),
  '200': detail('6', 'Clay', 'Clay pot'),
  '100': detail('5', 'Warmup', 'Untitled'),
};
function htmlByPath(path: string): string {
  if (path.includes('portfolio.asp')) return PORTFOLIO;
  const id = path.match(/id=(\d+)/)?.[1] ?? '';
  return DETAILS[id] ?? detail('', '', '');
}
const LASTMOD = 'Fri, 18 Mar 2022 15:51:37 GMT';
function imageResponse(lastModified = LASTMOD) {
  return new Response(new Uint8Array(20_000), { status: 200, headers: { 'content-type': 'image/jpeg', 'last-modified': lastModified } });
}

let harness: Awaited<ReturnType<typeof createTestHarness>>;
let dir: string;
beforeEach(() => {
  mockFetchHtml.mockReset();
  mockFetch.mockReset();
  mockFetchHtml.mockImplementation(((p: string) => Promise.resolve(htmlByPath(p))) as never);
  mockFetch.mockImplementation(() => Promise.resolve(imageResponse()));
  dir = mkdtempSync(join(tmpdir(), 'artsonia-dl-'));
});
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } });
afterAll(async () => { if (harness) await harness.close(); });
const parse = (res: any) => JSON.parse(res.content[0].text);

describe('buildFilename', () => {
  it('default template → grade/project/title with auto-appended id, slugified', () => {
    expect(buildFilename('{grade} - {project} - {title}', { grade: '6', project: 'Silhouette Still Life', title: 'My silhouette' }, '150567537'))
      .toBe('Grade 6 - Silhouette Still Life - My silhouette (150567537).jpg');
  });
  it('drops empty tokens and their separators', () => {
    expect(buildFilename('{grade} - {project} - {title}', { grade: null, project: '', title: 'Solo' }, '42')).toBe('Solo (42).jpg');
    expect(buildFilename('{grade} - {project} - {title}', { grade: '6', project: '', title: '' }, '42')).toBe('Grade 6 (42).jpg');
  });
  it('all-empty → just the artwork_id', () => {
    expect(buildFilename('{grade} - {project} - {title}', {}, '999')).toBe('999.jpg');
  });
  it('strips filesystem-unsafe characters', () => {
    expect(buildFilename('{title}', { title: 'a/b:c*d?"e<f>g|h' }, '7')).toBe('abcdefgh (7).jpg');
  });
  it('does not double-append the id when the template already includes it', () => {
    expect(buildFilename('{artwork_id}', {}, '123')).toBe('123.jpg');
    expect(buildFilename('{title} ({artwork_id})', { title: 'Sun' }, '5')).toBe('Sun (5).jpg');
  });
  it('substitutes {date}', () => {
    expect(buildFilename('{date} - {title}', { date: '2022-03-18', title: 'Sun' }, '5')).toBe('2022-03-18 - Sun (5).jpg');
  });
});

describe('artsonia_download_artwork', () => {
  it('setup + registers the tool', async () => {
    harness = await createTestHarness((s) => registerDownloadTools(s, client));
    expect((await harness.listTools()).map((t) => t.name)).toContain('artsonia_download_artwork');
  });

  it('dry run resolves descriptive filenames and writes nothing', async () => {
    const out = parse(await harness.callTool('artsonia_download_artwork', { artist_id: '1', dest: dir }));
    expect(out.preview).toBe(true);
    expect(out.count).toBe(3);
    expect(out.artworks[0]).toMatchObject({ artwork_id: '300', filename: 'Grade 6 - Silhouette - My silhouette (300).jpg' });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it('downloads with title-based names and sets mtime from Last-Modified', async () => {
    const out = parse(await harness.callTool('artsonia_download_artwork', { artist_id: '1', dest: dir, confirm: true }));
    expect(out.downloaded_count).toBe(3);
    expect(readdirSync(dir).sort()).toEqual([
      'Grade 5 - Warmup - Untitled (100).jpg',
      'Grade 6 - Clay - Clay pot (200).jpg',
      'Grade 6 - Silhouette - My silhouette (300).jpg',
    ]);
    const f = join(dir, 'Grade 6 - Silhouette - My silhouette (300).jpg');
    expect(statSync(f).mtime.toISOString().startsWith('2022-03-18')).toBe(true);
    const rec = out.downloaded.find((d: any) => d.artwork_id === '300');
    expect(rec.date_source).toBe('last-modified');
    expect(rec.timestamp.startsWith('2022-03-18')).toBe(true);
  });

  it('id-only template is the fast path (no detail fetch); mtime is download-time when disabled', async () => {
    const out = parse(await harness.callTool('artsonia_download_artwork', {
      artist_id: '1', dest: dir, filename_template: '{artwork_id}', set_mtime_from_source: false, confirm: true,
    }));
    expect(out.downloaded_count).toBe(3);
    expect(readdirSync(dir).sort()).toEqual(['100.jpg', '200.jpg', '300.jpg']);
    expect(mockFetchHtml).toHaveBeenCalledTimes(1); // portfolio only — no per-artwork detail
    expect(out.downloaded[0].date_source).toBe('download-time');
    expect(statSync(join(dir, '300.jpg')).mtime.getUTCFullYear()).not.toBe(2022);
  });

  it('skip_existing makes a re-run a no-op (no image re-fetch)', async () => {
    await harness.callTool('artsonia_download_artwork', { artist_id: '1', dest: dir, confirm: true });
    const callsAfterFirst = mockFetch.mock.calls.length;
    const out = parse(await harness.callTool('artsonia_download_artwork', { artist_id: '1', dest: dir, confirm: true }));
    expect(out.skipped_count).toBe(3);
    expect(out.downloaded_count).toBe(0);
    expect(mockFetch.mock.calls.length).toBe(callsAfterFirst); // no new image fetches
  });

  it('grade filter keeps only the matching grade', async () => {
    const out = parse(await harness.callTool('artsonia_download_artwork', { artist_id: '1', dest: dir, grade: 'Grade 6', confirm: true }));
    expect(out.downloaded_count).toBe(2);
    expect(readdirSync(dir).sort()).toEqual([
      'Grade 6 - Clay - Clay pot (200).jpg',
      'Grade 6 - Silhouette - My silhouette (300).jpg',
    ]);
  });

  it('project filter keeps only matches', async () => {
    const out = parse(await harness.callTool('artsonia_download_artwork', { artist_id: '1', dest: dir, project: 'clay', confirm: true }));
    expect(out.downloaded_count).toBe(1);
    expect(readdirSync(dir)).toEqual(['Grade 6 - Clay - Clay pot (200).jpg']);
  });

  it('most-recent-N keeps the newest N', async () => {
    const out = parse(await harness.callTool('artsonia_download_artwork', { artist_id: '1', dest: dir, limit: 2, filename_template: '{artwork_id}', confirm: true }));
    expect(out.downloaded_count).toBe(2);
    expect(readdirSync(dir).sort()).toEqual(['200.jpg', '300.jpg']);
  });

  it('reports failed downloads without throwing', async () => {
    mockFetch.mockImplementation((url: any) =>
      Promise.resolve(String(url).includes('/300.jpg') ? new Response('nope', { status: 404 }) : imageResponse()));
    const out = parse(await harness.callTool('artsonia_download_artwork', { artist_id: '1', dest: dir, filename_template: '{artwork_id}', confirm: true }));
    expect(out.downloaded_count).toBe(2);
    expect(out.failed_count).toBe(1);
    expect(out.failed[0]).toMatchObject({ artwork_id: '300', reason: 'HTTP 404' });
  });

  it('resolution flows through to the CDN url', async () => {
    await harness.callTool('artsonia_download_artwork', { artist_id: '1', dest: dir, limit: 1, resolution: 'large', filename_template: '{artwork_id}', confirm: true });
    expect(mockFetch).toHaveBeenCalledWith('https://images.artsonia.com/art/large/300.jpg');
  });
});
