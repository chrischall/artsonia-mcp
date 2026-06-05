import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { registerFeedbackTools } from '../../src/tools/feedback.js';
import { client } from '../../src/client.js';
import { createTestHarness } from '../helpers.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const feedback = readFileSync(join(FIX, 'feedback.html'), 'utf8');
const OK = { status: 302, body: '', url: 'https://www.artsonia.com/members/feedback/', setCookie: [] as string[], location: '/members/feedback/' };
const mockFetchHtml = vi.spyOn(client, 'fetchHtml').mockResolvedValue('' as never);
const mockWrite = vi.spyOn(client, 'write').mockResolvedValue(OK as never);

let harness: Awaited<ReturnType<typeof createTestHarness>>;
beforeEach(() => { mockFetchHtml.mockClear(); mockWrite.mockClear(); });
afterAll(async () => { if (harness) await harness.close(); });
const parse = (res: any) => JSON.parse(res.content[0].text);

describe('feedback tools', () => {
  it('setup + registers both tools', async () => {
    harness = await createTestHarness((s) => registerFeedbackTools(s, client));
    const names = (await harness.listTools()).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['artsonia_get_feedback', 'artsonia_mark_feedback_read']));
  });

  it('get_feedback fetches /members/feedback/?artist=<id> and returns items + unread_count', async () => {
    mockFetchHtml.mockResolvedValue(feedback as never);
    const out = parse(await harness.callTool('artsonia_get_feedback', { artist_id: '13447141' }));
    expect(mockFetchHtml).toHaveBeenCalledWith('/members/feedback/?artist=13447141');
    expect(out.feedback).toHaveLength(2);
    expect(out.unread_count).toBe(1);
    expect(out.feedback[0].message).toBe('Looks ready to start next class.');
  });

  it('mark_feedback_read without confirm is a dry run — no network call', async () => {
    const out = parse(await harness.callTool('artsonia_mark_feedback_read', { artist_id: '13447141' }));
    expect(out.preview).toBe(true);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('mark_feedback_read with confirm posts ConfirmAsRead to /members/feedback/default.asp', async () => {
    const out = parse(await harness.callTool('artsonia_mark_feedback_read', { artist_id: '13447141', confirm: true }));
    expect(mockWrite).toHaveBeenCalledWith('/members/feedback/default.asp?artist=13447141', 'ConfirmAsRead=Mark+as+Read');
    expect(out.marked_read).toBe(true);
  });
});
