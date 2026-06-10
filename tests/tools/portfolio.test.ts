import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { registerPortfolioTools } from '../../src/tools/portfolio.js';
import { client } from '../../src/client.js';
import { createTestHarness } from '../helpers.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const portfolio = readFileSync(join(FIX, 'portfolio.html'), 'utf8');
const artwork = readFileSync(join(FIX, 'artwork.html'), 'utf8');
const mockFetchHtml = vi.spyOn(client, 'fetchHtml').mockResolvedValue(undefined as never);

let harness: Awaited<ReturnType<typeof createTestHarness>>;
beforeEach(() => { mockFetchHtml.mockClear(); });
afterAll(async () => { if (harness) await harness.close(); });
const parse = (res: any) => JSON.parse(res.content[0].text);

describe('portfolio tools', () => {
  it('setup + registers three tools', async () => {
    harness = await createTestHarness((s) => registerPortfolioTools(s, client));
    const names = (await harness.listTools()).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['artsonia_get_portfolio', 'artsonia_get_artwork', 'artsonia_list_comments']));
  });
  it('get_portfolio fetches /artists/portfolio.asp?id=<artist_id>', async () => {
    mockFetchHtml.mockResolvedValue(portfolio);
    const out = parse(await harness.callTool('artsonia_get_portfolio', { artist_id: '13447141' }));
    expect(mockFetchHtml).toHaveBeenCalledWith('/artists/portfolio.asp?id=13447141');
    expect(out.artworks).toHaveLength(2);
    expect(out.artworks[0].artwork_id).toBe('150567537');
    expect(out.artworks[0].thumbnail).toBe('https://images.artsonia.com/art/small/150567537.jpg');
    expect(out.artworks[1].is_private).toBe(true);
  });
  it('get_artwork fetches /museum/art.asp?id=<artwork_id> and parses detail', async () => {
    mockFetchHtml.mockResolvedValue(artwork);
    const out = parse(await harness.callTool('artsonia_get_artwork', { artwork_id: '150567537' }));
    expect(mockFetchHtml).toHaveBeenCalledWith('/museum/art.asp?id=150567537');
    expect(out.title).toBe('My silhouette still life');
    expect(out.project).toBe('6th Grade Silhouette Still Life');
    expect(out.comment_entry.artist_id).toBe('13447141');
  });
  it('list_comments returns the comments array from the artwork page', async () => {
    mockFetchHtml.mockResolvedValue(artwork);
    const out = parse(await harness.callTool('artsonia_list_comments', { artwork_id: '150567537' }));
    // comments markup is UNVERIFIED for non-zero; fixture has 0 comments
    expect(Array.isArray(out.comments)).toBe(true);
  });
  it('get_portfolio without include_details returns lean tiles and fetches portfolio only', async () => {
    mockFetchHtml.mockResolvedValue(portfolio);
    const out = parse(await harness.callTool('artsonia_get_portfolio', { artist_id: '13447141' }));
    expect(mockFetchHtml).toHaveBeenCalledTimes(1); // portfolio only, no per-artwork detail
    expect(out.artworks[0]).not.toHaveProperty('title');
    expect(out.artworks[0]).not.toHaveProperty('project');
  });
  it('get_portfolio with include_details=true enriches each row with detail fields', async () => {
    mockFetchHtml.mockImplementation(((p: string) =>
      Promise.resolve(p.includes('portfolio.asp') ? portfolio : artwork)) as never);
    const out = parse(await harness.callTool('artsonia_get_portfolio', { artist_id: '13447141', include_details: true }));
    // portfolio (1) + one detail fetch per artwork (2) = 3
    expect(mockFetchHtml).toHaveBeenCalledTimes(3);
    expect(mockFetchHtml).toHaveBeenCalledWith('/museum/art.asp?id=150567537');
    expect(out.artworks).toHaveLength(2);
    expect(out.artworks[0].title).toBe('My silhouette still life');
    expect(out.artworks[0].project).toBe('6th Grade Silhouette Still Life');
    expect(out.artworks[0].grade).toBeDefined();
    // Lean tile fields are preserved.
    expect(out.artworks[0].artwork_id).toBe('150567537');
    expect(out.artworks[0].thumbnail).toBe('https://images.artsonia.com/art/small/150567537.jpg');
  });
  it('get_portfolio rejects a non-numeric artist_id', async () => {
    const result = await harness.callTool('artsonia_get_portfolio', { artist_id: 'abc' });
    expect(result.isError).toBe(true);
  });
});
