import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { registerFanTools } from '../../src/tools/fans.js';
import { client } from '../../src/client.js';
import { createTestHarness } from '../helpers.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const fans = readFileSync(join(FIX, 'fans.html'), 'utf8');
const mockFetchHtml = vi.spyOn(client, 'fetchHtml').mockResolvedValue(undefined as never);

let harness: Awaited<ReturnType<typeof createTestHarness>>;
beforeEach(() => { mockFetchHtml.mockClear(); });
afterAll(async () => { if (harness) await harness.close(); });
const parse = (res: any) => JSON.parse(res.content[0].text);

describe('fan tools', () => {
  it('setup', async () => { harness = await createTestHarness((s) => registerFanTools(s, client)); });
  it('get_fans fetches /members/fanclub/?artist=<id> and returns fans', async () => {
    mockFetchHtml.mockResolvedValue(fans);
    const out = parse(await harness.callTool('artsonia_get_fans', { artist_id: '13447141' }));
    expect(mockFetchHtml).toHaveBeenCalledWith('/members/fanclub/?artist=13447141');
    expect(out.fans).toHaveLength(2);
    expect(out.fans[0]).toMatchObject({ name: 'Chris Hall', relationship: 'Father' });
    expect(out.fans[1]).toMatchObject({ name: 'Grandma Jo', relationship: 'Grandparent' });
  });
});
