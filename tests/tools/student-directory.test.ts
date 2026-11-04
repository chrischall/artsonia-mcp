import { describe, it, expect, vi } from 'vitest';
import type { ArtsoniaClient } from '../../src/client.js';
import { loadStudentDirectory, STUDENT_LIST_TIMEOUT_MS } from '../../src/tools/student-directory.js';

/** A dashboard with synthetic students only. */
function dashboard(students: Array<{ id: string; name: string }>): string {
  return students
    .map((s) => `<div class="artist-card"><a href="/artists/portfolio.asp?id=${s.id}">p</a><a class="lightlink">${s.name}</a></div>`)
    .join('');
}

const clientFor = (fetchHtml: () => Promise<string>) => ({ fetchHtml: vi.fn(fetchHtml) }) as unknown as ArtsoniaClient;

describe('loadStudentDirectory', () => {
  it('bounds the start-time listing at 5 s', () => {
    expect(STUDENT_LIST_TIMEOUT_MS).toBe(5_000);
  });

  it('lists the students as labels, in dashboard order, from /members/', async () => {
    const c = clientFor(async () => dashboard([{ id: '101', name: 'Student A' }, { id: '202', name: 'Student B' }]));
    const dir = await loadStudentDirectory(c);
    expect(c.fetchHtml).toHaveBeenCalledWith('/members/');
    expect(dir?.labels).toEqual(['Student A', 'Student B']);
  });

  it('resolves a label in any case to its id, and passes a raw numeric id through', async () => {
    const dir = (await loadStudentDirectory(clientFor(async () => dashboard([{ id: '101', name: 'Student A' }]))))!;
    expect(dir.resolve('Student A')).toBe('101');
    expect(dir.resolve('  student a ')).toBe('101');
    expect(dir.resolve('101')).toBe('101');
    expect(dir.resolve('999')).toBe('999');
  });

  it('refuses an unknown label, naming the known ones', async () => {
    const dir = (await loadStudentDirectory(clientFor(async () => dashboard([{ id: '101', name: 'Student A' }]))))!;
    expect(() => dir.resolve('Nobody')).toThrow(/Unknown student "Nobody"\. Known: Student A\./);
  });

  it('disambiguates two students with one name by id, and labels a nameless one by id', async () => {
    const dir = (await loadStudentDirectory(clientFor(async () => dashboard([
      { id: '101', name: 'Sam' }, { id: '202', name: 'Sam' }, { id: '303', name: '' },
    ]))))!;
    expect(dir.labels).toEqual(['Sam (101)', 'Sam (202)', '303']);
    expect(dir.resolve('Sam (202)')).toBe('202');
    expect(() => dir.resolve('Sam')).toThrow(/Unknown student/);
  });

  it('answers null — never an empty enum — when nobody is followed', async () => {
    expect(await loadStudentDirectory(clientFor(async () => '<html></html>'))).toBeNull();
  });

  it('answers null when the listing fails (no credentials, no browser)', async () => {
    expect(await loadStudentDirectory(clientFor(async () => { throw new Error('environment variables are required'); }))).toBeNull();
  });

  it('answers null when the listing does not answer within the bound', async () => {
    vi.useFakeTimers();
    try {
      const pending = loadStudentDirectory(clientFor(() => new Promise<string>(() => {})), 50);
      await vi.advanceTimersByTimeAsync(60);
      expect(await pending).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
