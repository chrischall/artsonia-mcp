import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { registerWriteTools } from '../../src/tools/writes.js';
import { client } from '../../src/client.js';
import { createTestHarness } from '../helpers.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const profile = readFileSync(join(FIX, 'profile.html'), 'utf8');
const OK = { status: 302, body: '', url: 'https://www.artsonia.com/members/', setCookie: [] as string[], location: '/members/' };
const mockWrite = vi.spyOn(client, 'write').mockResolvedValue(OK as never);
const mockFetchHtml = vi.spyOn(client, 'fetchHtml').mockResolvedValue('' as never);

let harness: Awaited<ReturnType<typeof createTestHarness>>;
beforeEach(() => { mockWrite.mockClear(); mockFetchHtml.mockClear(); });
afterAll(async () => { if (harness) await harness.close(); });
const parse = (res: any) => JSON.parse(res.content[0].text);

describe('write tools', () => {
  it('setup + registers three tools', async () => {
    harness = await createTestHarness((s) => registerWriteTools(s, client));
    const names = (await harness.listTools()).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['artsonia_post_comment', 'artsonia_invite_fan', 'artsonia_set_notifications']));
  });

  it('post_comment without confirm is a dry run — no network call', async () => {
    const out = parse(await harness.callTool('artsonia_post_comment', { artist_id: '13447141', artwork_id: '150567537', comment: 'Great work!' }));
    expect(out.preview).toBe(true);
    expect(mockWrite).not.toHaveBeenCalled();
  });
  it('post_comment with confirm posts Comment to /museum/enter.asp and reports honestly (submitted, not verified)', async () => {
    const out = parse(await harness.callTool('artsonia_post_comment', { artist_id: '13447141', artwork_id: '150567537', comment: 'Great work!', confirm: true }));
    expect(mockWrite).toHaveBeenCalledWith('/museum/enter.asp?artist=13447141&art=150567537', 'Comment=Great+work%21');
    // A 3xx is not proof of persistence — no false `posted: true`.
    expect(out.posted).toBeUndefined();
    expect(out.submitted).toBe(true);
    expect(out.verified).toBe(false);
    expect(out.note).toMatch(/cannot confirm|verify/i);
  });

  it('invite_fan without confirm is a dry run', async () => {
    const out = parse(await harness.callTool('artsonia_invite_fan', { artist_id: '13447141', first_name: 'Test', last_name: 'Fan', email: 'test@example.com', relationship_id: '3' }));
    expect(out.preview).toBe(true);
    expect(mockWrite).not.toHaveBeenCalled();
  });
  it('invite_fan with confirm posts to /members/fanclub/add.asp and reports honestly (submitted, not verified)', async () => {
    const out = parse(await harness.callTool('artsonia_invite_fan', { artist_id: '13447141', first_name: 'Test', last_name: 'Fan', email: 'test@example.com', relationship_id: '3', confirm: true }));
    const [path, body] = mockWrite.mock.calls[0];
    expect(path).toBe('/members/fanclub/add.asp?artist=13447141');
    expect(body).toContain('FirstName=Test');
    expect(body).toContain('EmailAddress=test%40example.com');
    expect(body).toContain('RelationshipID=3');
    expect(body).toContain('ArtistID=13447141');
    // A 3xx is not proof of persistence — no false `invited: true`.
    expect(out.invited).toBeUndefined();
    expect(out.submitted).toBe(true);
    expect(out.verified).toBe(false);
    expect(out.note).toMatch(/cannot confirm|verify/i);
  });

  it('set_notifications without confirm previews the resulting opt-in state without writing', async () => {
    mockFetchHtml.mockResolvedValue(profile as never);
    const out = parse(await harness.callTool('artsonia_set_notifications', { artist_activity: false }));
    expect(out.preview).toBe(true);
    expect(out.wouldSend.OptInArtistActivity).toBe(false);
    expect(mockWrite).not.toHaveBeenCalled();
  });
  it('set_notifications with confirm re-sends the whole profile, flips only the chosen opt-in, blanks passwords', async () => {
    // Pre-read (original) then a verifying re-read showing News now checked.
    const after = profile.replace(/name="OptInNews" value="Y"/, 'name="OptInNews" value="Y" checked');
    mockFetchHtml.mockResolvedValueOnce(profile as never).mockResolvedValueOnce(after as never);
    await harness.callTool('artsonia_set_notifications', { news: true, confirm: true });
    const [path, body] = mockWrite.mock.calls[0];
    expect(path).toBe('/members/profile/default.asp');
    const params = new URLSearchParams(body);
    expect(params.get('FirstName')).toBe('Chris');
    expect(params.get('OptInNews')).toBe('Y');            // checked → real checkbox value, not "on"
    expect(params.get('OptInArtistActivity')).toBe('Y');  // preserved (was checked)
    expect(params.has('OptInPromos')).toBe(false);        // unchecked → omitted
    expect(params.get('NewPassword')).toBe('');           // password blanked
    expect(params.get('DidChangePassword')).toBe('N');    // preserved (no password change)
  });

  it('set_notifications re-reads after the write and reports verified when the opt-in actually flipped', async () => {
    // Turn News ON; the verifying re-read shows News checked → verified.
    const after = profile.replace(/name="OptInNews" value="Y"/, 'name="OptInNews" value="Y" checked');
    mockFetchHtml.mockResolvedValueOnce(profile as never).mockResolvedValueOnce(after as never);
    const out = parse(await harness.callTool('artsonia_set_notifications', { news: true, confirm: true }));
    expect(mockFetchHtml).toHaveBeenCalledTimes(2);                  // pre-read + verifying re-read
    expect(mockFetchHtml.mock.calls[1][0]).toBe('/members/profile/');
    expect(out.verified).toBe(true);
    expect(out.updated).toBe(true);
    expect(out.optIns.OptInNews).toBe(true);
  });

  it('set_notifications reports NOT verified when Artsonia 302s but the re-read shows no change persisted', async () => {
    // Turn News ON, but the re-read still shows News unchecked → the 302 did not persist.
    mockFetchHtml.mockResolvedValueOnce(profile as never).mockResolvedValueOnce(profile as never);
    const out = parse(await harness.callTool('artsonia_set_notifications', { news: true, confirm: true }));
    expect(out.verified).toBe(false);
    expect(out.updated).toBe(false);
    expect(out.optIns.OptInNews).toBe(false);                       // re-read truth, not the request
    expect(out.note).toMatch(/did not persist|not change/i);
    expect(out.requested.OptInNews).toBe(true);                    // what we asked for, surfaced honestly
  });
});
