import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { registerStudentTools } from '../../src/tools/students.js';
import { client } from '../../src/client.js';
import { createTestHarness } from '../helpers.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const dashboard = readFileSync(join(FIX, 'dashboard.html'), 'utf8');
const mockFetchHtml = vi.spyOn(client, 'fetchHtml').mockResolvedValue(undefined as never);

let harness: Awaited<ReturnType<typeof createTestHarness>>;
beforeEach(() => { mockFetchHtml.mockClear(); });
afterAll(async () => { if (harness) await harness.close(); });
function parse(res: any) { return JSON.parse(res.content[0].text); }

describe('student tools', () => {
  it('setup + registers both tools', async () => {
    harness = await createTestHarness((s) => registerStudentTools(s, client));
    const names = (await harness.listTools()).map((t) => t.name);
    expect(names).toContain('artsonia_list_students');
    expect(names).toContain('artsonia_get_activity');
  });
  it('artsonia_list_students fetches /members/ and returns parsed students', async () => {
    mockFetchHtml.mockResolvedValue(dashboard);
    const out = parse(await harness.callTool('artsonia_list_students'));
    expect(mockFetchHtml).toHaveBeenCalledWith('/members/');
    expect(out.students).toHaveLength(2);
    expect(out.students[0].artist_id).toBe('16011097');
    expect(out.students[0].name).toBe('Finn Hall');
    expect(out.students[0].artwork_count).toBe(46);
  });
  it('artsonia_get_activity returns notifications', async () => {
    mockFetchHtml.mockResolvedValue(dashboard);
    const out = parse(await harness.callTool('artsonia_get_activity'));
    expect(out.count).toBe(2);
    expect(out.items).toHaveLength(2);
  });
});
