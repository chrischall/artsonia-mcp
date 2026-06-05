import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { registerAccountTools } from '../../src/tools/account.js';
import { client } from '../../src/client.js';
import { createTestHarness } from '../helpers.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const awards = readFileSync(join(FIX, 'awards.html'), 'utf8');
const profile = readFileSync(join(FIX, 'profile.html'), 'utf8');
const mockFetchHtml = vi.spyOn(client, 'fetchHtml').mockResolvedValue('' as never);

let harness: Awaited<ReturnType<typeof createTestHarness>>;
beforeEach(() => { mockFetchHtml.mockClear(); });
afterAll(async () => { if (harness) await harness.close(); });
const parse = (res: any) => JSON.parse(res.content[0].text);

describe('account tools', () => {
  it('setup + registers both tools', async () => {
    harness = await createTestHarness((s) => registerAccountTools(s, client));
    const names = (await harness.listTools()).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['artsonia_get_awards', 'artsonia_get_profile']));
  });

  it('get_awards fetches /artists/awards.asp?id=<id> and returns awards + earned_count', async () => {
    mockFetchHtml.mockResolvedValue(awards as never);
    const out = parse(await harness.callTool('artsonia_get_awards', { artist_id: '13447141' }));
    expect(mockFetchHtml).toHaveBeenCalledWith('/artists/awards.asp?id=13447141');
    expect(out.awards).toHaveLength(4);
    expect(out.earned_count).toBe(3);
    expect(out.awards[0]).toMatchObject({ name: 'Portfolio', earned: true });
  });

  it('get_profile fetches /members/profile/ and returns name/email/opt-ins', async () => {
    mockFetchHtml.mockResolvedValue(profile as never);
    const out = parse(await harness.callTool('artsonia_get_profile'));
    expect(mockFetchHtml).toHaveBeenCalledWith('/members/profile/');
    expect(out.email).toBe('chris@example.com');
    expect(out.opt_ins).toMatchObject({ news: false, artist_activity: true, promos: false });
  });
});
