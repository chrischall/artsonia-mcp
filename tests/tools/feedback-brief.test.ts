import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { registerFeedbackTools, briefLine } from '../../src/tools/feedback.js';
import { client } from '../../src/client.js';
import { createTestHarness, parseResult } from '../helpers.js';
import type { StudentDirectory } from '../../src/tools/student-directory.js';

/** Synthetic feedback rows — no real names. */
function feedbackPage(rows: Array<{ id: string; message: string; unread: boolean }>): string {
  return rows
    .map((r) => `<div class="comment-row"><div class="comment-art"><a href="/museum/art.asp?id=${r.id}">a</a></div>` +
      `<div class="comment">${r.message}</div><div class="commenter">Posted 2 days ago by A Teacher (teacher)</div>` +
      `<div class="comment-options">${r.unread ? '<div>This feedback has not been marked as read.</div>' : ''}</div></div>`)
    .join('');
}

const mockFetchHtml = vi.spyOn(client, 'fetchHtml').mockResolvedValue('' as never);
const DIRECTORY: StudentDirectory = {
  labels: ['Student A'],
  resolve: (v) => {
    if (v === 'Student A') return '101';
    if (/^\d+$/.test(v)) return v;
    throw new Error(`Unknown student "${v}". Known: Student A.`);
  },
};

const harnesses: Array<{ close: () => Promise<void> }> = [];
afterAll(async () => { for (const h of harnesses) await h.close(); });
beforeEach(() => { mockFetchHtml.mockClear(); mockFetchHtml.mockResolvedValue('' as never); });

async function harnessWith(students: StudentDirectory | null) {
  const h = await createTestHarness((s) => registerFeedbackTools(s, client, students));
  harnesses.push(h);
  return h;
}

describe('briefLine', () => {
  it('reads "<message> — no date — <unread|read>" (Artsonia dates feedback only relatively)', () => {
    expect(briefLine({ message: 'Nice shading', is_read: false })).toBe('Nice shading — no date — unread');
    expect(briefLine({ message: 'Done', is_read: true })).toBe('Done — no date — read');
  });

  it('shortens a long message so the line stays within 120 characters', () => {
    const line = briefLine({ message: 'x'.repeat(300), is_read: false });
    expect(line.length).toBeLessThanOrEqual(120);
    expect(line.endsWith('… — no date — unread')).toBe(true);
  });

  it('collapses whitespace and names an empty message', () => {
    expect(briefLine({ message: '  a\n  b ', is_read: true })).toBe('a b — no date — read');
    expect(briefLine({ message: '', is_read: true })).toBe('(no message) — no date — read');
  });
});

describe('artsonia_get_feedback view: brief', () => {
  it('answers one line per item inside the untrusted-data envelope as data: string[]', async () => {
    mockFetchHtml.mockResolvedValue(feedbackPage([
      { id: '1', message: 'Great colors', unread: true },
      { id: '2', message: 'Finish the border', unread: false },
    ]) as never);
    const h = await harnessWith(null);
    const out = parseResult(await h.callTool('artsonia_get_feedback', { artist_id: '101', view: 'brief' }));
    expect(out.untrusted_content).toBe(true);
    expect(out.note).toMatch(/teachers/);
    expect(out.data).toEqual(['Great colors — no date — unread', 'Finish the border — no date — read']);
    expect(Object.keys(out)).toEqual(['untrusted_content', 'note', 'data']);
  });

  it('answers "-- none" for an empty feedback page', async () => {
    mockFetchHtml.mockResolvedValue('<html></html>' as never);
    const h = await harnessWith(null);
    const out = parseResult(await h.callTool('artsonia_get_feedback', { artist_id: '101', view: 'brief' }));
    expect(out.data).toEqual(['-- none']);
  });

  it('keeps the full answer as the default and under view: full', async () => {
    mockFetchHtml.mockResolvedValue(feedbackPage([{ id: '1', message: 'Great colors', unread: true }]) as never);
    const h = await harnessWith(null);
    for (const args of [{ artist_id: '101' }, { artist_id: '101', view: 'full' }]) {
      const out = parseResult(await h.callTool('artsonia_get_feedback', args));
      expect(out.unread_count).toBe(1);
      expect(out.feedback[0].message).toBe('Great colors');
    }
  });

  it('accepts a student label from the enum and fetches that student by id', async () => {
    mockFetchHtml.mockResolvedValue('' as never);
    const h = await harnessWith(DIRECTORY);
    await h.callTool('artsonia_get_feedback', { artist_id: 'Student A', view: 'brief' });
    expect(mockFetchHtml).toHaveBeenCalledWith('/members/feedback/?artist=101');
  });

  it('still accepts a raw numeric artist_id when the enum is published', async () => {
    mockFetchHtml.mockResolvedValue('' as never);
    const h = await harnessWith(DIRECTORY);
    await h.callTool('artsonia_get_feedback', { artist_id: '202' });
    expect(mockFetchHtml).toHaveBeenCalledWith('/members/feedback/?artist=202');
  });

  it('refuses an unknown label without fetching', async () => {
    const h = await harnessWith(DIRECTORY);
    const res = await h.callTool('artsonia_get_feedback', { artist_id: 'Nobody' });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toMatch(/Unknown student/);
    expect(mockFetchHtml).not.toHaveBeenCalled();
  });

  it('refuses a non-numeric artist_id when no enum is published', async () => {
    const h = await harnessWith(null);
    const res = await h.callTool('artsonia_get_feedback', { artist_id: 'Student A' });
    expect(res.isError).toBe(true);
    expect(mockFetchHtml).not.toHaveBeenCalled();
  });
});
