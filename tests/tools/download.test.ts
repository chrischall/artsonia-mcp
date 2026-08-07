import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import * as piexif from 'piexif-ts';
import { registerDownloadTools, buildFilename, buildRelPath } from '../../src/tools/download.js';
import { NodeDownloadIO } from '../../src/tools/download-io.js';
import { client } from '../../src/client.js';
import { createTestHarness } from '../helpers.js';
import { tinyJpeg, parseIptc } from '../jpeg-fixture.js';
import { mkdtempSync, rmSync, readdirSync, statSync, readFileSync } from 'node:fs';
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
// Same three artworks, but the newest (300) is private.
const PORTFOLIO_PRIVATE = `<div class="grid">
  <div class="grid-item"><div class="grid-item-art"><a href="/museum/art.asp?id=300"><div class="genthumb"></div><div class="private-art"></div></a></div></div>
  <div class="grid-item"><div class="grid-item-art"><a href="/museum/art.asp?id=200"><div class="genthumb"></div></a></div></div>
  <div class="grid-item"><div class="grid-item-art"><a href="/museum/art.asp?id=100"><div class="genthumb"></div></a></div></div>
</div>`;
const detail = (grade: string, project: string, title: string, commentsHtml = '') =>
  `<html><head><title>Artsonia Art Museum :: "${title}" by Kid1</title></head><body>
   <div class="textNormal">created by Kid1 in Grade ${grade} at School</div>
   <div>from school project "${project}"</div>${commentsHtml}</body></html>`;
const DETAILS: Record<string, string> = {
  '300': detail('6', 'Silhouette', 'My silhouette',
    '<div class="comment"><div class="comment-author">Grandma</div><div class="comment-text">Love it!</div></div>'),
  '200': detail('6', 'Clay', 'Clay pot'),
  '100': detail('5', 'Warmup', 'Untitled'),
};
// Teacher feedback page for the student: one item, about artwork 300.
const FEEDBACK = `<div class="comment-row">
  <div class="comment-art"><a href="/museum/art.asp?id=300"><img src="x.jpg"></a></div>
  <div class="comment">Great work on values.</div>
  <div class="commenter">Posted 1 month ago by Curt Atkins (teacher)</div>
  <div class="comment-options"></div>
</div>`;
// Parent dashboard (for the post-run artwork_count sanity check): a student whose
// artwork_count (46) does NOT match the 3-tile portfolio above.
const MEMBERS = `<div class="artist-card">
  <a class="lightlink" href="/artists/portfolio.asp?id=16011097">Finn Hall</a>
  <div>Currently at School (Grade 1)</div>
  <div class="stat">46 artworks</div>
</div>`;
// Dashboard variant where the count matches the portfolio (3 artworks for artist 1).
const MEMBERS_MATCHING = `<div class="artist-card">
  <a class="lightlink" href="/artists/portfolio.asp?id=1">Kid One</a>
  <div>Currently at School (Grade 6)</div>
  <div class="stat">3 artworks</div>
</div>`;
function htmlByPath(path: string): string {
  if (path.includes('portfolio.asp')) return path.includes('id=2') ? PORTFOLIO_PRIVATE : PORTFOLIO;
  if (path.includes('/members/feedback/')) return FEEDBACK;
  if (path === '/members/') return MEMBERS;
  const id = path.match(/id=(\d+)/)?.[1] ?? '';
  return DETAILS[id] ?? detail('', '', '');
}
const LASTMOD = 'Fri, 18 Mar 2022 15:51:37 GMT';
function imageResponse(lastModified = LASTMOD) {
  return new Response(new Uint8Array(20_000), {
    status: 200,
    headers: { 'content-type': 'image/jpeg', 'content-length': '20000', 'last-modified': lastModified },
  });
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
  it('substitutes {school_year} derived from the date (July–June)', () => {
    expect(buildFilename('{school_year} - {title}', { date: '2022-03-18', title: 'Sun' }, '5')).toBe('2021-2022 - Sun (5).jpg');
    expect(buildFilename('{school_year} - {title}', { date: '2021-09-10', title: 'Sun' }, '5')).toBe('2021-2022 - Sun (5).jpg');
    expect(buildFilename('{school_year} - {title}', { title: 'Sun' }, '5')).toBe('Sun (5).jpg'); // no date → token collapses
  });
});

describe('buildRelPath', () => {
  it('resolves tokens into slugified path segments', () => {
    expect(buildRelPath('{grade}/{project}', { grade: '6', project: 'Clay' }, '42')).toEqual(['Grade 6', 'Clay']);
  });
  it('collapses empty tokens — no empty path segments', () => {
    expect(buildRelPath('{grade}/{project}/', { grade: null, project: 'Clay' }, '42')).toEqual(['Clay']);
    expect(buildRelPath('{title}', {}, '42')).toEqual([]);
  });
  it('derives {school_year} from the date', () => {
    expect(buildRelPath('{school_year}', { date: '2022-03-18' }, '42')).toEqual(['2021-2022']);
    expect(buildRelPath('{school_year}', { date: '2021-09-10' }, '42')).toEqual(['2021-2022']);
  });
  it('a slash inside a token value never creates an extra directory', () => {
    expect(buildRelPath('{project}', { project: 'a/b: c' }, '1')).toEqual(['ab c']);
  });
  it('drops "." / ".." segments — templates cannot escape dest', () => {
    expect(buildRelPath('../{project}', { project: 'Clay' }, '1')).toEqual(['Clay']);
  });
});

describe('artsonia_download_artwork', () => {
  it('setup + registers the tool', async () => {
    harness = await createTestHarness((s) => registerDownloadTools(s, client, () => new NodeDownloadIO()));
    expect((await harness.listTools()).map((t) => t.name)).toContain('artsonia_download_artwork');
  });

  it('dry run resolves descriptive filenames and writes nothing (only HEAD size probes, no GETs)', async () => {
    const out = parse(await harness.callTool('artsonia_download_artwork', { artist_id: '1', dest: dir }));
    expect(out.preview).toBe(true);
    expect(out.count).toBe(3);
    expect(out.artworks[0]).toMatchObject({ artwork_id: '300', filename: 'Grade 6 - Silhouette - My silhouette (300).jpg' });
    // Size estimation may probe the public CDN, but only with HEAD — never a body download.
    for (const [, init] of mockFetch.mock.calls) expect((init as RequestInit)?.method).toBe('HEAD');
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it('dry run reports estimated bytes per item and in total, plus is_private', async () => {
    const out = parse(await harness.callTool('artsonia_download_artwork', { artist_id: '2', dest: dir }));
    expect(out.preview).toBe(true);
    expect(out.estimated_total_bytes).toBe(60_000);
    expect(out.artworks[0]).toMatchObject({ artwork_id: '300', is_private: true, estimated_bytes: 20_000 });
    expect(out.artworks[1]).toMatchObject({ artwork_id: '200', is_private: false, estimated_bytes: 20_000 });
    expect(out.private_count).toBe(1);
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it('dry run estimates degrade gracefully when the HEAD probe fails', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error('network down')));
    const out = parse(await harness.callTool('artsonia_download_artwork', { artist_id: '1', dest: dir }));
    expect(out.preview).toBe(true);
    expect(out.count).toBe(3);
    expect(out.estimated_total_bytes).toBeUndefined();
    expect(out.artworks[0].estimated_bytes).toBeUndefined();
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
    // Portfolio + the /members/ count-check page only — no per-artwork detail.
    expect(mockFetchHtml).toHaveBeenCalledTimes(2);
    expect(mockFetchHtml.mock.calls.map((c) => c[0])).not.toContainEqual(expect.stringContaining('art.asp'));
    expect(out.downloaded[0].date_source).toBe('download-time');
    expect(statSync(join(dir, '300.jpg')).mtime.getUTCFullYear()).not.toBe(2022);
  });

  it('write_metadata does not break the id-only fast path in dry-run (comments unused in previews)', async () => {
    const out = parse(await harness.callTool('artsonia_download_artwork', {
      artist_id: '1', dest: dir, filename_template: '{artwork_id}', write_metadata: true,
    }));
    expect(out.preview).toBe(true);
    // Portfolio only — the preview discards comments, so no per-artwork detail.
    expect(mockFetchHtml).toHaveBeenCalledTimes(1);
    expect(mockFetchHtml.mock.calls.map((c) => c[0])).not.toContainEqual(expect.stringContaining('art.asp'));
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

  it('limit + default template only fetches detail for the newest N (no whole-portfolio scan)', async () => {
    const out = parse(await harness.callTool('artsonia_download_artwork', { artist_id: '1', dest: dir, limit: 2, confirm: true }));
    expect(out.downloaded_count).toBe(2);
    // portfolio (1) + detail for the 2 newest only = 3 fetches, NOT 4 (id 100 never fetched).
    expect(mockFetchHtml).toHaveBeenCalledTimes(3);
    expect(mockFetchHtml).not.toHaveBeenCalledWith('/museum/art.asp?id=100');
    expect(readdirSync(dir).sort()).toEqual([
      'Grade 6 - Clay - Clay pot (200).jpg',
      'Grade 6 - Silhouette - My silhouette (300).jpg',
    ]);
  });

  it('a malformed Last-Modified header falls back to download-time, not failure', async () => {
    mockFetch.mockImplementation(() => Promise.resolve(imageResponse('not-a-real-date')));
    const out = parse(await harness.callTool('artsonia_download_artwork', { artist_id: '1', dest: dir, filename_template: '{artwork_id}', confirm: true }));
    expect(out.downloaded_count).toBe(3);
    expect(out.failed_count).toBe(0);
    expect(out.downloaded[0].date_source).toBe('download-time');
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

  it('without write_index, no manifest is written and result has no index_file', async () => {
    const out = parse(await harness.callTool('artsonia_download_artwork', { artist_id: '1', dest: dir, confirm: true }));
    expect(out.downloaded_count).toBe(3);
    expect(readdirSync(dir)).not.toContain('index.json');
    expect(out.index_file).toBeUndefined();
  });

  it('write_index writes index.json listing the downloaded items and reports its path', async () => {
    const out = parse(await harness.callTool('artsonia_download_artwork', { artist_id: '1', dest: dir, write_index: true, confirm: true }));
    expect(out.downloaded_count).toBe(3);
    const indexPath = join(dir, 'index.json');
    expect(out.index_file).toBe(indexPath);
    expect(readdirSync(dir)).toContain('index.json');
    const manifest = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(manifest.count).toBe(3);
    expect(manifest.items).toHaveLength(3);
    const item = manifest.items.find((i: any) => i.artwork_id === '300');
    expect(item).toMatchObject({
      artwork_id: '300',
      title: 'My silhouette',
      project: 'Silhouette',
      grade: '6',
      file: 'Grade 6 - Silhouette - My silhouette (300).jpg',
    });
  });

  it('write_index still writes a manifest (of on-disk items) when everything is skipped on a re-run', async () => {
    // First run downloads everything.
    await harness.callTool('artsonia_download_artwork', { artist_id: '1', dest: dir, confirm: true });
    // Re-run with skip_existing + write_index: nothing downloads, but the
    // manifest must still be written (no silent absence) and list what's there.
    const out = parse(
      await harness.callTool('artsonia_download_artwork', {
        artist_id: '1', dest: dir, skip_existing: true, write_index: true, confirm: true,
      }),
    );
    expect(out.downloaded_count).toBe(0);
    expect(out.skipped_count).toBe(3);
    const indexPath = join(dir, 'index.json');
    expect(out.index_file).toBe(indexPath); // present, not silently omitted
    const manifest = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(manifest.count).toBe(3); // the 3 already-present (skipped) items
    expect(manifest.items).toHaveLength(3);
  });

  // --- richer result: totals + is_private (issue #15) ---

  it('result reports total_bytes and per-file is_private', async () => {
    const out = parse(await harness.callTool('artsonia_download_artwork', { artist_id: '2', dest: dir, filename_template: '{artwork_id}', confirm: true }));
    expect(out.downloaded_count).toBe(3);
    expect(out.total_bytes).toBe(60_000);
    expect(out.private_count).toBe(1);
    expect(out.downloaded.find((d: any) => d.artwork_id === '300').is_private).toBe(true);
    expect(out.downloaded.find((d: any) => d.artwork_id === '200').is_private).toBe(false);
  });

  it('skipped entries also carry is_private', async () => {
    await harness.callTool('artsonia_download_artwork', { artist_id: '2', dest: dir, filename_template: '{artwork_id}', confirm: true });
    const out = parse(await harness.callTool('artsonia_download_artwork', { artist_id: '2', dest: dir, filename_template: '{artwork_id}', confirm: true }));
    expect(out.skipped_count).toBe(3);
    expect(out.total_bytes).toBe(0);
    expect(out.skipped.find((s: any) => s.artwork_id === '300').is_private).toBe(true);
  });

  it('include_private:false excludes private pieces and reports how many were dropped', async () => {
    const out = parse(await harness.callTool('artsonia_download_artwork', {
      artist_id: '2', dest: dir, filename_template: '{artwork_id}', include_private: false, confirm: true,
    }));
    expect(out.downloaded_count).toBe(2);
    expect(readdirSync(dir).sort()).toEqual(['100.jpg', '200.jpg']);
    expect(out.private_excluded_count).toBe(1);
    expect(out.private_count).toBe(0);
  });

  // --- post-run artwork_count sanity check (issue #15) ---

  it('warns when downloaded+skipped does not match the student artwork_count', async () => {
    const out = parse(await harness.callTool('artsonia_download_artwork', {
      artist_id: '16011097', dest: dir, filename_template: '{artwork_id}', confirm: true,
    }));
    expect(out.downloaded_count).toBe(3);
    expect(out.count_check).toEqual({ expected: 46, on_disk: 3, ok: false });
    expect(out.warning).toMatch(/artwork_count/);
  });

  it('count check passes silently when the counts match', async () => {
    mockFetchHtml.mockImplementation(((p: string) =>
      Promise.resolve(p === '/members/' ? MEMBERS_MATCHING : htmlByPath(p))) as never);
    const out = parse(await harness.callTool('artsonia_download_artwork', {
      artist_id: '1', dest: dir, filename_template: '{artwork_id}', confirm: true,
    }));
    expect(out.count_check).toEqual({ expected: 3, on_disk: 3, ok: true });
    expect(out.warning).toBeUndefined();
  });

  it('count check is skipped when the run is filtered (limit/project/grade/include_private)', async () => {
    const out = parse(await harness.callTool('artsonia_download_artwork', {
      artist_id: '16011097', dest: dir, limit: 2, filename_template: '{artwork_id}', confirm: true,
    }));
    expect(out.count_check).toBeUndefined();
    expect(out.warning).toBeUndefined();
    expect(mockFetchHtml).not.toHaveBeenCalledWith('/members/');
  });

  it('a failing count-check read never fails the download', async () => {
    mockFetchHtml.mockImplementation(((p: string) =>
      p === '/members/' ? Promise.reject(new Error('boom')) : Promise.resolve(htmlByPath(p))) as never);
    const out = parse(await harness.callTool('artsonia_download_artwork', {
      artist_id: '1', dest: dir, filename_template: '{artwork_id}', confirm: true,
    }));
    expect(out.downloaded_count).toBe(3);
    expect(out.count_check).toBeUndefined();
  });

  // --- write_metadata sidecars: comments + teacher feedback (issue #12) ---

  it('without write_metadata, no sidecar .json files are written (default behavior preserved)', async () => {
    await harness.callTool('artsonia_download_artwork', { artist_id: '1', dest: dir, confirm: true });
    expect(readdirSync(dir).filter((f) => f.endsWith('.json'))).toHaveLength(0);
  });

  it('write_metadata writes a per-artwork sidecar with comments and teacher feedback', async () => {
    const out = parse(await harness.callTool('artsonia_download_artwork', { artist_id: '1', dest: dir, write_metadata: true, confirm: true }));
    expect(out.downloaded_count).toBe(3);
    expect(out.metadata_count).toBe(3);
    // The teacher-feedback page was fetched once via the client (reuses artsonia_get_feedback's source).
    expect(mockFetchHtml).toHaveBeenCalledWith('/members/feedback/?artist=1');
    const sidecar = JSON.parse(readFileSync(join(dir, 'Grade 6 - Silhouette - My silhouette (300).json'), 'utf8'));
    expect(sidecar).toMatchObject({
      artwork_id: '300',
      title: 'My silhouette',
      project: 'Silhouette',
      grade: '6',
      comments: [{ author: 'Grandma', text: 'Love it!' }],
    });
    expect(sidecar.feedback).toHaveLength(1);
    expect(sidecar.feedback[0]).toMatchObject({ message: 'Great work on values.' });
    // Artworks with no comments/feedback still get a sidecar with empty arrays.
    const empty = JSON.parse(readFileSync(join(dir, 'Grade 6 - Clay - Clay pot (200).json'), 'utf8'));
    expect(empty.comments).toEqual([]);
    expect(empty.feedback).toEqual([]);
  });

  it('write_metadata works on the id-only template (fetches detail for the sidecars) and on skipped re-runs', async () => {
    await harness.callTool('artsonia_download_artwork', { artist_id: '1', dest: dir, filename_template: '{artwork_id}', confirm: true });
    const out = parse(await harness.callTool('artsonia_download_artwork', {
      artist_id: '1', dest: dir, filename_template: '{artwork_id}', write_metadata: true, confirm: true,
    }));
    expect(out.skipped_count).toBe(3);
    expect(out.metadata_count).toBe(3); // sidecars written for already-present images too
    const sidecar = JSON.parse(readFileSync(join(dir, '300.json'), 'utf8'));
    expect(sidecar.comments).toEqual([{ author: 'Grandma', text: 'Love it!' }]);
  });

  // --- path_template: folder layouts for multi-year archives (issue #14) ---

  it('without path_template the layout stays flat (default behavior preserved)', async () => {
    await harness.callTool('artsonia_download_artwork', { artist_id: '1', dest: dir, confirm: true });
    expect(readdirSync(dir, { withFileTypes: true }).every((e) => e.isFile())).toBe(true);
  });

  it('path_template lays files out into nested folders composed with filename_template', async () => {
    const out = parse(await harness.callTool('artsonia_download_artwork', {
      artist_id: '1', dest: dir, path_template: '{grade}/{project}', filename_template: '{title}', confirm: true,
    }));
    expect(out.downloaded_count).toBe(3);
    expect(readdirSync(join(dir, 'Grade 6', 'Silhouette'))).toEqual(['My silhouette (300).jpg']);
    expect(readdirSync(join(dir, 'Grade 6', 'Clay'))).toEqual(['Clay pot (200).jpg']);
    expect(readdirSync(join(dir, 'Grade 5', 'Warmup'))).toEqual(['Untitled (100).jpg']);
  });

  it('path_template {school_year} folders derive from the image Last-Modified', async () => {
    const out = parse(await harness.callTool('artsonia_download_artwork', {
      artist_id: '1', dest: dir, path_template: '{school_year}', filename_template: '{artwork_id}', confirm: true,
    }));
    expect(out.downloaded_count).toBe(3);
    // LASTMOD is 2022-03-18 → school year 2021-2022.
    expect(readdirSync(join(dir, '2021-2022')).sort()).toEqual(['100.jpg', '200.jpg', '300.jpg']);
  });

  it('path_template re-runs are idempotent: skip_existing skips across template paths (no re-fetch)', async () => {
    await harness.callTool('artsonia_download_artwork', {
      artist_id: '1', dest: dir, path_template: '{grade}/{project}', confirm: true,
    });
    const callsAfterFirst = mockFetch.mock.calls.length;
    const out = parse(await harness.callTool('artsonia_download_artwork', {
      artist_id: '1', dest: dir, path_template: '{grade}/{project}', confirm: true,
    }));
    expect(out.skipped_count).toBe(3);
    expect(out.downloaded_count).toBe(0);
    expect(mockFetch.mock.calls.length).toBe(callsAfterFirst); // no new image fetches
  });

  it('dry run with path_template previews the folder-relative paths and writes nothing', async () => {
    const out = parse(await harness.callTool('artsonia_download_artwork', {
      artist_id: '1', dest: dir, path_template: '{grade}/{project}', filename_template: '{title}',
    }));
    expect(out.preview).toBe(true);
    expect(out.artworks[0]).toMatchObject({ artwork_id: '300', filename: 'Grade 6/Silhouette/My silhouette (300).jpg' });
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it('write_index with path_template records folder-relative file paths', async () => {
    const out = parse(await harness.callTool('artsonia_download_artwork', {
      artist_id: '1', dest: dir, path_template: '{grade}/{project}', write_index: true, confirm: true,
    }));
    expect(out.downloaded_count).toBe(3);
    const manifest = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
    const item = manifest.items.find((i: any) => i.artwork_id === '300');
    expect(item.file).toBe('Grade 6/Silhouette/Grade 6 - Silhouette - My silhouette (300).jpg');
  });

  it('write_metadata sidecars land next to their images inside template folders', async () => {
    const out = parse(await harness.callTool('artsonia_download_artwork', {
      artist_id: '1', dest: dir, path_template: '{grade}/{project}', write_metadata: true, confirm: true,
    }));
    expect(out.metadata_count).toBe(3);
    const sidecar = JSON.parse(readFileSync(join(dir, 'Grade 6', 'Silhouette', 'Grade 6 - Silhouette - My silhouette (300).json'), 'utf8'));
    expect(sidecar.artwork_id).toBe('300');
  });

  // --- embed_metadata: EXIF/IPTC inside the JPEG (issue #13) ---

  it('embed_metadata default off: written bytes are byte-identical to the source image', async () => {
    mockFetch.mockImplementation(() => Promise.resolve(new Response(tinyJpeg(), {
      status: 200,
      headers: { 'content-type': 'image/jpeg', 'content-length': String(tinyJpeg().length), 'last-modified': LASTMOD },
    })));
    await harness.callTool('artsonia_download_artwork', { artist_id: '1', dest: dir, confirm: true });
    const written = readFileSync(join(dir, 'Grade 6 - Silhouette - My silhouette (300).jpg'));
    expect(written.equals(tinyJpeg())).toBe(true);
  });

  it('embed_metadata writes EXIF + IPTC that parse back from the downloaded JPEG', async () => {
    mockFetch.mockImplementation(() => Promise.resolve(new Response(tinyJpeg(), {
      status: 200,
      headers: { 'content-type': 'image/jpeg', 'content-length': String(tinyJpeg().length), 'last-modified': LASTMOD },
    })));
    const out = parse(await harness.callTool('artsonia_download_artwork', {
      artist_id: '1', dest: dir, embed_metadata: true, confirm: true,
    }));
    expect(out.downloaded_count).toBe(3);
    expect(out.embedded_count).toBe(3);
    const f = join(dir, 'Grade 6 - Silhouette - My silhouette (300).jpg');
    const written = readFileSync(f);
    const exif = piexif.load(written.toString('latin1'));
    expect(exif['0th']![piexif.TagValues.ImageIFD.ImageDescription]).toBe('My silhouette');
    // Date comes from the image's Last-Modified, same source as date_source.
    expect(exif['Exif']![piexif.TagValues.ExifIFD.DateTimeOriginal]).toBe('2022:03:18 15:51:37');
    const sets = parseIptc(written);
    const keywords = sets.filter((s) => s.record === 2 && s.dataset === 25).map((s) => s.data.toString('utf8'));
    expect(keywords).toEqual(expect.arrayContaining(['Silhouette', 'Grade 6']));
    // mtime is still set from Last-Modified after embedding.
    expect(statSync(f).mtime.toISOString().startsWith('2022-03-18')).toBe(true);
  });

  it('embed_metadata failure (non-JPEG payload) degrades gracefully: original bytes written, run not failed', async () => {
    const out = parse(await harness.callTool('artsonia_download_artwork', {
      artist_id: '1', dest: dir, embed_metadata: true, confirm: true,
    }));
    // The default mock returns 20k zero bytes — not a JPEG — so embedding fails per-file.
    expect(out.downloaded_count).toBe(3);
    expect(out.failed_count).toBe(0);
    expect(out.embedded_count).toBe(0);
    const written = readFileSync(join(dir, 'Grade 6 - Silhouette - My silhouette (300).jpg'));
    expect(written.equals(Buffer.alloc(20_000))).toBe(true);
  });

  it('embed_metadata keeps the id-only fast path in dry-run (detail only fetched on confirmed runs)', async () => {
    const out = parse(await harness.callTool('artsonia_download_artwork', {
      artist_id: '1', dest: dir, filename_template: '{artwork_id}', embed_metadata: true,
    }));
    expect(out.preview).toBe(true);
    expect(mockFetchHtml).toHaveBeenCalledTimes(1); // portfolio only
    expect(mockFetchHtml.mock.calls.map((c) => c[0])).not.toContainEqual(expect.stringContaining('art.asp'));
  });

  it('embed_metadata on the id-only template fetches detail on the confirmed run (fields needed for EXIF)', async () => {
    mockFetch.mockImplementation(() => Promise.resolve(new Response(tinyJpeg(), {
      status: 200,
      headers: { 'content-type': 'image/jpeg', 'content-length': String(tinyJpeg().length), 'last-modified': LASTMOD },
    })));
    const out = parse(await harness.callTool('artsonia_download_artwork', {
      artist_id: '1', dest: dir, filename_template: '{artwork_id}', embed_metadata: true, confirm: true,
    }));
    expect(out.embedded_count).toBe(3);
    const exif = piexif.load(readFileSync(join(dir, '300.jpg')).toString('latin1'));
    expect(exif['0th']![piexif.TagValues.ImageIFD.ImageDescription]).toBe('My silhouette');
  });
});
