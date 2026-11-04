import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  NumericIdString,
  UNTRUSTED_CONTENT_RULE,
  UNTRUSTED_DESCRIPTION_SUFFIX,
  minifiedResult,
  toolAnnotations,
  untrustedResult,
} from '@chrischall/mcp-utils';
import type { ArtsoniaClient } from '../client.js';
import { parseFeedback } from '../parse.js';
import { schoolMeta } from './hints.js';
import type { StudentDirectory } from './student-directory.js';

const BRIEF_MAX = 120;

/** Who writes the text a brief feedback line carries, for the untrusted envelope's note. */
const FEEDBACK_NOTE = `Feedback messages are written by your student's teachers. ${UNTRUSTED_CONTENT_RULE}`;

/**
 * One feedback item as one line, `<message> — no date — <unread|read>`, at
 * most 120 characters (the message is shortened). Artsonia dates feedback only
 * relatively ("Posted 9 months ago"), so there is no ISO date to give.
 * A message that starts with `-- ` or `\` is escaped with one leading `\`, so
 * a teacher-written message can never read as a note line (the gateway strips
 * one backslash from every item line).
 */
export function briefLine(item: { message: string; is_read: boolean }): string {
  const text = item.message.replace(/\s+/g, ' ').trim() || '(no message)';
  const message = text.startsWith('-- ') || text.startsWith('\\') ? `\\${text}` : text;
  const tail = ` — no date — ${item.is_read ? 'read' : 'unread'}`;
  const room = BRIEF_MAX - tail.length;
  const shown = message.length > room ? `${message.slice(0, Math.max(room - 1, 0))}…` : message;
  return `${shown}${tail}`;
}

const ARTIST_ID_DESCRIPTION = 'Student artist_id (from artsonia_list_students).';

/**
 * `artist_id` for the canonical read. With a start-time student listing it
 * publishes the student LABELS as a JSON Schema `enum` (via `.meta()`, so the
 * runtime schema is still any string and the handler accepts a label or a raw
 * numeric id); with none it is the plain numeric id it always was — an empty
 * `enum` is invalid JSON Schema.
 *
 * The enum is the NAMES only, and the description says so (artsonia#244).
 * Not `anyOf [names, numeric pattern]`: a host that fans a question out over
 * the subject reads a top-level `enum` only (mcp-host context groups, D5), so
 * an `anyOf` would hide every student from it. Not the ids in the enum either:
 * that fan-out would then read each student twice. A caller that does not
 * validate against the schema may still send the numeric artist_id, and
 * `StudentDirectory.resolve` passes it through (a student followed after start
 * included).
 */
export const ARTIST_ID_ENUM_DESCRIPTION =
  'The student, by name as listed here (from artsonia_list_students). ' +
  'The server also resolves a numeric artist_id, but this schema offers the names only.';

function artistIdArg(students: StudentDirectory | null | undefined) {
  if (!students) return NumericIdString.describe(ARTIST_ID_DESCRIPTION);
  return z.string().meta({ enum: students.labels }).describe(ARTIST_ID_ENUM_DESCRIPTION);
}

/** Count the unread items in a student's feedback page. */
async function unreadCount(client: ArtsoniaClient, artist_id: string): Promise<number> {
  const feedback = parseFeedback(await client.fetchHtml(`/members/feedback/?artist=${artist_id}`));
  return feedback.filter((f) => !f.is_read).length;
}

export function registerFeedbackTools(
  server: McpServer,
  client: ArtsoniaClient,
  students?: StudentDirectory | null,
): void {
  server.registerTool(
    'artsonia_get_feedback',
    {
      title: 'Get teacher feedback for a student',
      description:
        "List the teacher feedback left on a student's artwork — each item's message, who posted it and when, the artwork it's about, and whether it's been marked as read. Pass the artist_id from artsonia_list_students. view: \"brief\" answers one line per item (message — no date — unread|read), or \"-- none\". " + UNTRUSTED_DESCRIPTION_SUFFIX,
      annotations: toolAnnotations({ title: 'Get teacher feedback for a student', readOnly: true, openWorld: true }),
      _meta: schoolMeta('whats-new', {
        canonical: true,
        subject: 'artist_id',
        aliases: ['art', 'art teacher', 'art class', 'artwork', 'artsonia', 'teacher feedback'],
      }),
      inputSchema: z.object({
        artist_id: artistIdArg(students),
        view: z
          .enum(['full', 'brief'])
          .optional()
          .describe('"full" (default) returns every feedback item with unread_count; "brief" returns one line per item: message — no date — unread|read.'),
      }),
    },
    async ({ artist_id: raw, view }) => {
      const artist_id = students ? students.resolve(raw) : raw;
      const feedback = parseFeedback(await client.fetchHtml(`/members/feedback/?artist=${artist_id}`));
      if (view === 'brief') {
        const lines = feedback.length === 0 ? ['-- none'] : feedback.map(briefLine);
        return untrustedResult(lines, { note: FEEDBACK_NOTE });
      }
      return untrustedResult({
        artist_id,
        unread_count: feedback.filter((f) => !f.is_read).length,
        feedback,
      });
    },
  );

  server.registerTool(
    'artsonia_mark_feedback_read',
    {
      title: 'Mark a student\'s feedback as read',
      description:
        "Mark the student's teacher feedback as read (this is a mark-ALL action — Artsonia has no per-item control). Runs immediately, with no confirmation step: it only changes the read state in your own view.",
      // Destructive by the inverse test: nothing in this tool set marks feedback
      // unread again, and it marks ALL of the student's feedback at once.
      annotations: toolAnnotations({ title: "Mark a student's feedback as read", readOnly: false, openWorld: true, destructive: true }),
      _meta: schoolMeta('change'),
      inputSchema: z.object({
        artist_id: NumericIdString.describe('Student artist_id (from artsonia_list_students).'),
      }),
    },
    // Ungated (chrischall/fleet-audit#1154): it only flips the read state in the
    // parent's own view, so a confirmation round trip is friction, not safety.
    async ({ artist_id }) => {
      const path = `/members/feedback/default.asp?artist=${artist_id}`;
      const body = new URLSearchParams({ ConfirmAsRead: 'Mark as Read' }).toString();
      const res = await client.write(path, body);
      // A 3xx doesn't prove the mark-all stuck (Artsonia 302s even on payloads it
      // drops). Re-read the feedback page and confirm nothing is still unread.
      const remaining = await unreadCount(client, artist_id);
      const verified = remaining === 0;
      return minifiedResult({
        marked_read: verified,
        verified,
        unread_remaining: remaining,
        artist_id,
        status: res.status,
        ...(verified
          ? {}
          : { note: 'Artsonia accepted the request but a re-read still shows unread feedback — the mark-as-read did not fully persist.' }),
      });
    },
  );
}
