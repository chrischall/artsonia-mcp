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
beforeEach(() => mockFetchHtml.mockClear());
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
    expect(out.artworks[1].is_private).toBe(true);
  });
  it('get_artwork fetches /museum/art.asp?id=<artwork_id> and parses detail', async () => {
    mockFetchHtml.mockResolvedValue(artwork);
    const out = parse(await harness.callTool('artsonia_get_artwork', { artwork_id: '150567537' }));
    expect(mockFetchHtml).toHaveBeenCalledWith('/museum/art.asp?id=150567537');
    expect(out.title).toBe('My silhouette still life');
    expect(out.comment_entry.artist_id).toBe('13447141');
  });
  it('list_comments returns the comments array from the artwork page', async () => {
    mockFetchHtml.mockResolvedValue(artwork);
    const out = parse(await harness.callTool('artsonia_list_comments', { artwork_id: '150567537' }));
    expect(out.comments[0].author).toBe('Grandma');
  });
  it('get_portfolio rejects a non-numeric artist_id', async () => {
    const result = await harness.callTool('artsonia_get_portfolio', { artist_id: 'abc' });
    expect(result.isError).toBe(true);
  });
});
