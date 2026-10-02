import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  CONFIRM_FLOW_SENTENCE,
  NumericIdString,
  confirmTokenParam,
  confirmWrite,
  minifiedResult,
  toolAnnotations,
} from '@chrischall/mcp-utils';
import type { ArtsoniaClient } from '../client.js';
import { parseFeedback } from '../parse.js';

/** Count the unread items in a student's feedback page. */
async function unreadCount(client: ArtsoniaClient, artist_id: string): Promise<number> {
  const feedback = parseFeedback(await client.fetchHtml(`/members/feedback/?artist=${artist_id}`));
  return feedback.filter((f) => !f.is_read).length;
}

export function registerFeedbackTools(server: McpServer, client: ArtsoniaClient): void {
  server.registerTool(
    'artsonia_get_feedback',
    {
      title: 'Get teacher feedback for a student',
      description:
        "List the teacher feedback left on a student's artwork — each item's message, who posted it and when, the artwork it's about, and whether it's been marked as read. Pass the artist_id from artsonia_list_students.",
      annotations: toolAnnotations({ title: 'Get teacher feedback for a student', readOnly: true, openWorld: true }),
      inputSchema: z.object({ artist_id: NumericIdString.describe('Student artist_id (from artsonia_list_students).') }),
    },
    async ({ artist_id }) => {
      const feedback = parseFeedback(await client.fetchHtml(`/members/feedback/?artist=${artist_id}`));
      return minifiedResult({
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
        "Mark the student's teacher feedback as read (this is a mark-ALL action — Artsonia has no per-item control). " + CONFIRM_FLOW_SENTENCE,
      annotations: toolAnnotations({ title: "Mark a student's feedback as read", readOnly: false, openWorld: true, destructive: false }),
      inputSchema: z.object({
        artist_id: NumericIdString.describe('Student artist_id (from artsonia_list_students).'),
        confirmToken: confirmTokenParam,
      }),
    },
    async ({ artist_id, confirmToken }, ctx) => {
      const path = `/members/feedback/default.asp?artist=${artist_id}`;
      const body = new URLSearchParams({ ConfirmAsRead: 'Mark as Read' }).toString();
      const gate = await confirmWrite(ctx, {
        tool: 'artsonia_mark_feedback_read',
        action: 'artsonia.mark_feedback_read',
        message: "Review and confirm marking ALL of this student's teacher feedback as read:",
        // One signed-in Artsonia account per server process.
        account: undefined,
        target: artist_id,
        request: { method: 'POST', path, body: { ConfirmAsRead: 'Mark as Read' } },
        preview: { note: "Marks ALL of this student's feedback as read (Artsonia has no per-item control)." },
        confirmToken,
      });
      if (gate) return gate;
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
