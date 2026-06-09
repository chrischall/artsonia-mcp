import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { parse } from 'node-html-parser';
import { textResult, toolAnnotations, schemaConfirm } from '@chrischall/mcp-utils';
import type { ArtsoniaClient } from '../client.js';

const NumericId = z.string().regex(/^\d+$/, 'must be a numeric id');

function previewResult(action: string, wouldSend: Record<string, unknown>, caveat?: string) {
  return textResult({
    preview: true,
    action,
    note: `DRY RUN — nothing was sent. Re-run with confirm: true to perform this write.${caveat ? ` ${caveat}` : ''}`,
    wouldSend,
  });
}

const OPTIN_FIELDS = { news: 'OptInNews', artist_activity: 'OptInArtistActivity', promos: 'OptInPromos' } as const;
const PASSWORD_FIELDS = new Set(['OldPassword', 'NewPassword', 'NewPassword2']);

interface ProfileForm {
  fields: Record<string, string>;
  checkboxes: Record<string, boolean>;
  /** The `value` attribute each checkbox submits when checked (Artsonia uses "Y", not "on"). */
  checkboxValues: Record<string, string>;
}

export function parseProfileForm(html: string): ProfileForm {
  const form = parse(html).querySelector('#TheForm');
  if (!form) throw new Error('Could not find the Artsonia profile form (#TheForm).');
  const fields: Record<string, string> = {};
  const checkboxes: Record<string, boolean> = {};
  const checkboxValues: Record<string, string> = {};
  for (const el of form.querySelectorAll('input, select')) {
    const name = el.getAttribute('name');
    if (!name) continue;
    const type = (el.getAttribute('type') ?? el.tagName.toLowerCase());
    if (type === 'checkbox') {
      checkboxes[name] = el.hasAttribute('checked');
      // Artsonia opt-in checkboxes submit value="Y" when checked — a literal "on"
      // is silently ignored by the server (the save 302s but persists nothing).
      checkboxValues[name] = el.getAttribute('value') ?? 'Y';
    } else if (el.tagName.toLowerCase() === 'select') {
      const sel = el.querySelector('option[selected]') ?? el.querySelector('option');
      fields[name] = sel?.getAttribute('value') ?? '';
    } else {
      fields[name] = el.getAttribute('value') ?? '';
    }
  }
  return { fields, checkboxes, checkboxValues };
}

export function registerWriteTools(server: McpServer, client: ArtsoniaClient): void {
  server.registerTool(
    'artsonia_post_comment',
    {
      title: 'Post a comment on an artwork',
      description: "Post a comment on a student's artwork. Without confirm:true this is a DRY RUN that returns a preview and makes no network call.",
      annotations: toolAnnotations({ title: 'Post a comment on an artwork', readOnly: false, openWorld: true }),
      inputSchema: {
        artist_id: NumericId.describe('Student artist_id (from artsonia_list_students).'),
        artwork_id: NumericId.describe('Artwork id (from artsonia_get_portfolio).'),
        comment: z.string().min(1).describe('The comment text to post.'),
        confirm: schemaConfirm,
      },
    },
    async ({ artist_id, artwork_id, comment, confirm }) => {
      const path = `/museum/enter.asp?artist=${artist_id}&art=${artwork_id}`;
      if (confirm !== true) return previewResult('post_comment', { path, Comment: comment });
      const body = new URLSearchParams({ Comment: comment }).toString();
      const res = await client.write(path, body);
      // A 3xx only means Artsonia accepted the POST — not that the comment was
      // persisted (it 302s even on payloads it silently drops), and there is no
      // cheap per-comment re-read to confirm. Report honestly.
      return textResult({
        submitted: true,
        verified: false,
        note: 'Artsonia accepted the comment (HTTP ' + res.status + '), but this server cannot confirm it persisted. Check the artwork page to verify.',
        artist_id,
        artwork_id,
        status: res.status,
      });
    },
  );

  server.registerTool(
    'artsonia_invite_fan',
    {
      title: "Invite a fan to a student's fan club",
      description: "Invite someone (by name + email) to follow a student's Artsonia portfolio. Sends them an invite email. Without confirm:true this is a DRY RUN. Use only real addresses you're authorized to invite (test with @example.com).",
      annotations: toolAnnotations({ title: 'Invite a fan', readOnly: false, openWorld: true }),
      inputSchema: {
        artist_id: NumericId.describe('Student artist_id (from artsonia_list_students).'),
        first_name: z.string().min(1).describe("Fan's first name."),
        last_name: z.string().min(1).describe("Fan's last name."),
        email: z.string().email().describe("Fan's email address (they receive an invite)."),
        relationship_id: NumericId.describe('Relationship code (RelationshipID select value from the Add Fans form).'),
        is_parent: z.boolean().default(false).describe('Whether this fan is also a parent/guardian.'),
        confirm: schemaConfirm,
      },
    },
    async ({ artist_id, first_name, last_name, email, relationship_id, is_parent, confirm }) => {
      const path = `/members/fanclub/add.asp?artist=${artist_id}`;
      const params = new URLSearchParams({
        MemberType: 'fan',
        RelationshipID: relationship_id,
        FirstName: first_name,
        LastName: last_name,
        EmailAddress: email,
        ArtistID: artist_id,
      });
      if (is_parent) params.set('IsParent', 'on');
      if (confirm !== true) {
        return previewResult('invite_fan', { path, ...Object.fromEntries(params) }, 'Verify RelationshipID against the live Add Fans form; MemberType is assumed "fan".');
      }
      const res = await client.write(path, params.toString());
      // 3xx ⇒ accepted, not confirmed-sent; no cheap re-read for a pending invite.
      return textResult({
        submitted: true,
        verified: false,
        note: 'Artsonia accepted the invite (HTTP ' + res.status + '), but this server cannot confirm the email was sent. Ask the fan to check their inbox.',
        artist_id,
        email,
        status: res.status,
      });
    },
  );

  server.registerTool(
    'artsonia_set_notifications',
    {
      title: 'Set notification preferences',
      description: "Turn the account's email opt-ins on/off (news, artist activity, promos). Reads your profile, changes only the opt-in(s) you specify, and re-saves — leaving your name/email/password untouched. Without confirm:true this is a DRY RUN showing the resulting state.",
      annotations: toolAnnotations({ title: 'Set notification preferences', readOnly: false, openWorld: true }),
      inputSchema: {
        news: z.boolean().optional().describe('OptInNews — general Artsonia news emails.'),
        artist_activity: z.boolean().optional().describe('OptInArtistActivity — emails about your student(s) activity.'),
        promos: z.boolean().optional().describe('OptInPromos — promotional/keepsake emails.'),
        confirm: schemaConfirm,
      },
    },
    async ({ news, artist_activity, promos, confirm }) => {
      const desired: Record<string, boolean | undefined> = { news, artist_activity, promos };
      if (news === undefined && artist_activity === undefined && promos === undefined) {
        return textResult({ error: 'Specify at least one of news / artist_activity / promos.' });
      }
      const { fields, checkboxes, checkboxValues } = parseProfileForm(await client.fetchHtml('/members/profile/'));
      const nextChecks = { ...checkboxes };
      for (const [key, fieldName] of Object.entries(OPTIN_FIELDS)) {
        const want = desired[key as keyof typeof desired];
        if (want !== undefined) nextChecks[fieldName] = want;
      }
      const params = new URLSearchParams();
      // Re-send every non-checkbox field verbatim (preserving the form's own
      // DidChangePassword="N" so the server doesn't attempt a password change),
      // except the password fields, which are always blanked.
      for (const [name, value] of Object.entries(fields)) {
        if (PASSWORD_FIELDS.has(name)) { params.set(name, ''); continue; }
        params.set(name, value);
      }
      // Checked opt-ins are submitted with the checkbox's real value ("Y"); unchecked
      // boxes are omitted, exactly as the browser form does.
      for (const [name, on] of Object.entries(nextChecks)) {
        if (on) params.set(name, checkboxValues[name] ?? 'Y');
      }
      const resultingOptIns = {
        OptInNews: nextChecks['OptInNews'] ?? false,
        OptInArtistActivity: nextChecks['OptInArtistActivity'] ?? false,
        OptInPromos: nextChecks['OptInPromos'] ?? false,
      };
      if (confirm !== true) {
        return previewResult('set_notifications', { ...resultingOptIns }, 'Re-sends your full profile (name/email preserved, password blanked) to flip only the opt-in(s).');
      }
      const res = await client.write('/members/profile/default.asp', params.toString());
      // Artsonia 302s on a subtly-wrong payload but persists NOTHING, so a 3xx
      // is not proof of success. Re-read the profile and confirm the opt-ins
      // actually flipped before claiming the change stuck.
      const after = parseProfileForm(await client.fetchHtml('/members/profile/'));
      const persisted = {
        OptInNews: after.checkboxes['OptInNews'] ?? false,
        OptInArtistActivity: after.checkboxes['OptInArtistActivity'] ?? false,
        OptInPromos: after.checkboxes['OptInPromos'] ?? false,
      };
      const verified =
        persisted.OptInNews === resultingOptIns.OptInNews &&
        persisted.OptInArtistActivity === resultingOptIns.OptInArtistActivity &&
        persisted.OptInPromos === resultingOptIns.OptInPromos;
      return textResult({
        updated: verified,
        verified,
        optIns: persisted,
        status: res.status,
        ...(verified
          ? {}
          : {
              note: 'Artsonia accepted the request (3xx) but a re-read shows the opt-ins did not change — the save did not persist. Re-check the form fields and retry.',
              requested: resultingOptIns,
            }),
      });
    },
  );
}
