import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { registerWriteTools } from '../../src/tools/writes.js';
import { client } from '../../src/client.js';
import {
  ACCEPT, DECLINE, callConfirmed, createTestHarness, parseResult as parse, phaseOne, restoreConfirmEnvAfterEach,
} from '../helpers.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const profile = readFileSync(join(FIX, 'profile.html'), 'utf8');
const OK = { status: 302, body: '', url: 'https://www.artsonia.com/members/', setCookie: [] as string[], location: '/members/' };
const mockWrite = vi.spyOn(client, 'write').mockResolvedValue(OK as never);
const mockFetchHtml = vi.spyOn(client, 'fetchHtml').mockResolvedValue('' as never);

const COMMENT = { artist_id: '13447141', artwork_id: '150567537', comment: 'Great work!' };
const INVITE = { artist_id: '13447141', first_name: 'Test', last_name: 'Fan', email: 'test@example.com', relationship_id: '3' };

let harness: Awaited<ReturnType<typeof createTestHarness>>;
beforeEach(() => { mockWrite.mockClear(); mockFetchHtml.mockReset(); mockFetchHtml.mockResolvedValue('' as never); });
afterAll(async () => { if (harness) await harness.close(); });
restoreConfirmEnvAfterEach();

describe('write tools', () => {
  it('setup + registers three tools, each taking confirmToken and no confirm', async () => {
    harness = await createTestHarness((s) => registerWriteTools(s, client));
    const { tools } = await harness.client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['artsonia_post_comment', 'artsonia_invite_fan', 'artsonia_set_notifications']));
    for (const t of tools) {
      const props = Object.keys(t.inputSchema.properties ?? {});
      expect(props).toContain('confirmToken');
      expect(props).not.toContain('confirm');
      expect(t.description).toMatch(/confirmToken/);
      expect(t.description).not.toMatch(/confirm:\s*true/);
    }
  });

  it('post_comment phase 1 returns the preview + a token and makes no network call', async () => {
    const out = await phaseOne(harness, 'artsonia_post_comment', COMMENT);
    expect(out.preview.wouldSend).toEqual({ path: '/museum/enter.asp?artist=13447141&art=150567537', Comment: 'Great work!' });
    expect(out.confirmToken).toEqual(expect.any(String));
    expect(mockWrite).not.toHaveBeenCalled();
  });
  it('post_comment phase 2 posts Comment to /museum/enter.asp once and reports honestly (submitted, not verified)', async () => {
    const out = parse(await callConfirmed(harness, 'artsonia_post_comment', COMMENT));
    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite).toHaveBeenCalledWith('/museum/enter.asp?artist=13447141&art=150567537', 'Comment=Great+work%21');
    // A 3xx is not proof of persistence — no false `posted: true`.
    expect(out.posted).toBeUndefined();
    expect(out.submitted).toBe(true);
    expect(out.verified).toBe(false);
    expect(out.note).toMatch(/cannot confirm|verify/i);
  });
  it('post_comment refuses a replayed token (TOKEN_REUSED) without writing again', async () => {
    const { confirmToken } = await phaseOne(harness, 'artsonia_post_comment', COMMENT);
    await harness.callTool('artsonia_post_comment', { ...COMMENT, confirmToken });
    mockWrite.mockClear();
    const res = await harness.callTool('artsonia_post_comment', { ...COMMENT, confirmToken });
    expect(res.isError).toBe(true);
    expect(parse(res).error).toBe('TOKEN_REUSED');
    expect(mockWrite).not.toHaveBeenCalled();
  });
  it('post_comment refuses a token when the comment changed between phases (DRAFT_CHANGED)', async () => {
    const { confirmToken } = await phaseOne(harness, 'artsonia_post_comment', COMMENT);
    const res = await harness.callTool('artsonia_post_comment', { ...COMMENT, comment: 'Something else', confirmToken });
    expect(res.isError).toBe(true);
    const out = parse(res);
    expect(out.error).toBe('DRAFT_CHANGED');
    expect(out.preview.wouldSend.Comment).toBe('Something else'); // fresh preview of what would now be sent
    expect(mockWrite).not.toHaveBeenCalled();
  });
  it('post_comment writes on a client that can prompt and accepts', async () => {
    const h = await createTestHarness((s) => registerWriteTools(s, client), ACCEPT);
    try {
      const out = parse(await h.callTool('artsonia_post_comment', COMMENT));
      expect(out.submitted).toBe(true);
      expect(mockWrite).toHaveBeenCalledTimes(1);
    } finally { await h.close(); }
  });
  it('post_comment does not write when the prompt is declined', async () => {
    const h = await createTestHarness((s) => registerWriteTools(s, client), DECLINE);
    try {
      const out = parse(await h.callTool('artsonia_post_comment', COMMENT));
      expect(out.confirmed).toBe(false);
      expect(mockWrite).not.toHaveBeenCalled();
    } finally { await h.close(); }
  });
  it('MCP_CONFIRM_MODE=refuse refuses on a client that cannot prompt, without writing', async () => {
    process.env.MCP_CONFIRM_MODE = 'refuse';
    const out = parse(await harness.callTool('artsonia_post_comment', COMMENT));
    expect(out.reason).toBe('confirmation-unsupported');
    expect(out.confirmToken).toBeUndefined();
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('invite_fan phase 1 previews the form it would send, with the RelationshipID caveat, and does not write', async () => {
    const out = await phaseOne(harness, 'artsonia_invite_fan', INVITE);
    expect(out.preview.wouldSend).toMatchObject({
      path: '/members/fanclub/add.asp?artist=13447141', MemberType: 'fan', RelationshipID: '3',
      FirstName: 'Test', LastName: 'Fan', EmailAddress: 'test@example.com', ArtistID: '13447141',
    });
    expect(out.preview.note).toMatch(/RelationshipID/);
    expect(mockWrite).not.toHaveBeenCalled();
  });
  it('invite_fan phase 2 posts to /members/fanclub/add.asp once and reports honestly (submitted, not verified)', async () => {
    const out = parse(await callConfirmed(harness, 'artsonia_invite_fan', { ...INVITE, is_parent: true }));
    expect(mockWrite).toHaveBeenCalledTimes(1);
    const [path, body] = mockWrite.mock.calls[0];
    expect(path).toBe('/members/fanclub/add.asp?artist=13447141');
    expect(body).toContain('FirstName=Test');
    expect(body).toContain('EmailAddress=test%40example.com');
    expect(body).toContain('RelationshipID=3');
    expect(body).toContain('ArtistID=13447141');
    expect(body).toContain('IsParent=on');
    // A 3xx is not proof of persistence — no false `invited: true`.
    expect(out.invited).toBeUndefined();
    expect(out.submitted).toBe(true);
    expect(out.verified).toBe(false);
    expect(out.note).toMatch(/cannot confirm|verify/i);
  });

  it('set_notifications still refuses an empty request before any read or prompt', async () => {
    const out = parse(await harness.callTool('artsonia_set_notifications', {}));
    expect(out.error).toMatch(/at least one/);
    expect(mockFetchHtml).not.toHaveBeenCalled();
    expect(mockWrite).not.toHaveBeenCalled();
  });
  it('set_notifications phase 1 previews the resulting opt-in state without writing', async () => {
    mockFetchHtml.mockResolvedValue(profile as never);
    const out = await phaseOne(harness, 'artsonia_set_notifications', { artist_activity: false });
    expect(out.preview.wouldSend.OptInArtistActivity).toBe(false);
    expect(out.preview.note).toMatch(/password blanked/);
    expect(mockWrite).not.toHaveBeenCalled();
  });
  it('set_notifications phase 2 re-sends the whole profile once, flips only the chosen opt-in, blanks passwords', async () => {
    // Phase-1 read, phase-2 fresh read, then the verifying re-read showing News now checked.
    const after = profile.replace(/name="OptInNews" value="Y"/, 'name="OptInNews" value="Y" checked');
    mockFetchHtml.mockResolvedValueOnce(profile as never).mockResolvedValueOnce(profile as never).mockResolvedValueOnce(after as never);
    await callConfirmed(harness, 'artsonia_set_notifications', { news: true });
    expect(mockWrite).toHaveBeenCalledTimes(1);
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
  it('set_notifications refuses the token when the profile changed between phases (DRAFT_CHANGED), without writing', async () => {
    const renamed = profile.replace(/value="Chris"/, 'value="Christopher"');
    mockFetchHtml.mockResolvedValueOnce(profile as never).mockResolvedValueOnce(renamed as never);
    const { confirmToken } = await phaseOne(harness, 'artsonia_set_notifications', { news: true });
    const res = await harness.callTool('artsonia_set_notifications', { news: true, confirmToken });
    expect(res.isError).toBe(true);
    expect(parse(res).error).toBe('DRAFT_CHANGED');
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('set_notifications re-reads after the write and reports verified when the opt-in actually flipped', async () => {
    const after = profile.replace(/name="OptInNews" value="Y"/, 'name="OptInNews" value="Y" checked');
    mockFetchHtml.mockResolvedValueOnce(profile as never).mockResolvedValueOnce(profile as never).mockResolvedValueOnce(after as never);
    const out = parse(await callConfirmed(harness, 'artsonia_set_notifications', { news: true }));
    expect(mockFetchHtml).toHaveBeenCalledTimes(3);                  // phase-1 read + phase-2 read + verifying re-read
    expect(mockFetchHtml.mock.calls[2][0]).toBe('/members/profile/');
    expect(out.verified).toBe(true);
    expect(out.updated).toBe(true);
    expect(out.optIns.OptInNews).toBe(true);
  });

  it('set_notifications reports NOT verified when Artsonia 302s but the re-read shows no change persisted', async () => {
    mockFetchHtml.mockResolvedValue(profile as never); // every read, incl. the re-read, still shows News unchecked
    const out = parse(await callConfirmed(harness, 'artsonia_set_notifications', { news: true }));
    expect(out.verified).toBe(false);
    expect(out.updated).toBe(false);
    expect(out.optIns.OptInNews).toBe(false);                       // re-read truth, not the request
    expect(out.note).toMatch(/did not persist|not change/i);
    expect(out.requested.OptInNews).toBe(true);                    // what we asked for, surfaced honestly
  });
});
