import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { registerHealthcheckTools } from '../../src/tools/healthcheck.js';
import { client } from '../../src/client.js';
import { createTestHarness } from '../helpers.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const dashboard = readFileSync(join(FIX, 'dashboard.html'), 'utf8');
const mockFetchHtml = vi.spyOn(client, 'fetchHtml').mockResolvedValue('' as never);

let harness: Awaited<ReturnType<typeof createTestHarness>>;
beforeEach(() => mockFetchHtml.mockClear());
afterAll(async () => { if (harness) await harness.close(); });
const parse = (res: any) => JSON.parse(res.content[0].text);

describe('artsonia_healthcheck', () => {
  it('setup', async () => { harness = await createTestHarness((s) => registerHealthcheckTools(s, client)); });
  it('reports authenticated + student_count on success', async () => {
    mockFetchHtml.mockResolvedValue(dashboard as never);
    const out = parse(await harness.callTool('artsonia_healthcheck'));
    expect(out.ok).toBe(true);
    expect(out.authenticated).toBe(true);
    expect(out.student_count).toBe(2);
  });
  it('reports a helpful hint when login fails', async () => {
    mockFetchHtml.mockRejectedValue(new Error('ARTSONIA_USERNAME and ARTSONIA_PASSWORD environment variables are required'));
    const out = parse(await harness.callTool('artsonia_healthcheck'));
    expect(out.ok).toBe(false);
    expect(out.hint).toMatch(/ARTSONIA_USERNAME|credentials/i);
  });
});
