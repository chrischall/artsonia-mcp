import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { registerFeedbackTools, briefLine } from '../../src/tools/feedback.js';
import { client } from '../../src/client.js';
import { createTestHarness, parseResult } from '../helpers.js';
import { loadStudentDirectory, type StudentDirectory } from '../../src/tools/student-directory.js';
import type { ArtsoniaClient } from '../../src/client.js';

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

  it('escapes a message that starts with "-- " or "\\" with one leading backslash, so it never reads as a note', () => {
    expect(briefLine({ message: '-- none', is_read: false })).toBe('\\-- none — no date — unread');
    expect(briefLine({ message: '\\ok', is_read: true })).toBe('\\\\ok — no date — read');
    expect(briefLine({ message: '--none', is_read: true })).toBe('--none — no date — read');
  });

  it('escapes a message that is just "--" (it trims to "--", and the composed line would start with "-- ")', () => {
    for (const message of ['--', '-- ', '  --  ', '--\n']) {
      const line = briefLine({ message, is_read: false });
      expect(line).toBe('\\-- — no date — unread');
      expect(line.startsWith('-- ')).toBe(false);
    }
  });

  it('keeps an escaped long message within 120 characters as a whole line', () => {
    const line = briefLine({ message: `-- ${'x'.repeat(300)}`, is_read: false });
    expect(line.length).toBeLessThanOrEqual(120);
    expect(line.startsWith('\\-- x')).toBe(true);
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

/**
 * artsonia#244: the subject enum lists the student NAMES — the schema's
 * contract, since the gateway reads a top-level `enum` only — while the
 * handler still resolves a raw numeric artist_id for a caller that does not
 * validate against the schema. Driven through the REAL directory.
 */
describe('artsonia_get_feedback artist_id: names in the schema, a numeric id still accepted', () => {
  const dashboard = '<div class="artist-card"><a href="/artists/portfolio.asp?id=101">p</a><a class="lightlink">Student A</a></div>';
  async function realDirectory(): Promise<StudentDirectory> {
    const c = { fetchHtml: vi.fn(async () => dashboard) } as unknown as ArtsoniaClient;
    return (await loadStudentDirectory(c))!;
  }
  async function servedArtistId(h: Awaited<ReturnType<typeof harnessWith>>) {
    const tool = (await h.client.listTools()).tools.find((t) => t.name === 'artsonia_get_feedback')!;
    return (tool.inputSchema.properties as Record<string, Record<string, unknown>>).artist_id;
  }

  it('publishes the names as a top-level enum (never anyOf) and says a numeric id is still accepted', async () => {
    const h = await harnessWith(await realDirectory());
    const prop = await servedArtistId(h);
    expect(prop.enum).toEqual(['Student A']);
    expect(prop).not.toHaveProperty('anyOf');
    expect(prop.description).toMatch(/this schema offers the names only/);
    expect(prop.description).toMatch(/also resolves a numeric artist_id/);
  });

  it('accepts the numeric artist_id of a listed student', async () => {
    const h = await harnessWith(await realDirectory());
    const res = await h.callTool('artsonia_get_feedback', { artist_id: '101' });
    expect(res.isError).toBeFalsy();
    expect(mockFetchHtml).toHaveBeenCalledWith('/members/feedback/?artist=101');
  });

  it('accepts the numeric artist_id of a student followed after start', async () => {
    const h = await harnessWith(await realDirectory());
    const res = await h.callTool('artsonia_get_feedback', { artist_id: '999', view: 'brief' });
    expect(res.isError).toBeFalsy();
    expect(mockFetchHtml).toHaveBeenCalledWith('/members/feedback/?artist=999');
  });
});
