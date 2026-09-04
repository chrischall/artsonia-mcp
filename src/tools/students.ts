import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { minifiedResult, toolAnnotations } from '@chrischall/mcp-utils';
import type { ArtsoniaClient } from '../client.js';
import { parseStudents, parseNotifications } from '../parse.js';

export function registerStudentTools(server: McpServer, client: ArtsoniaClient): void {
  server.registerTool(
    'artsonia_list_students',
    {
      title: 'List followed students',
      description: 'List the student(s) on your Artsonia parent/fan account with their artist_id, name, school, grade, and artwork/fan counts. The artist_id is the selector used by the portfolio, comments, and fan tools.',
      annotations: toolAnnotations({ title: 'List followed students', openWorld: true }),
    },
    async () => minifiedResult({ students: parseStudents(await client.fetchHtml('/members/')) }),
  );
  server.registerTool(
    'artsonia_get_activity',
    {
      title: 'Get account notifications',
      description: 'Return the notification/activity feed on the parent dashboard (e.g. new teacher feedback, fan-club prompts), with a count and the list of notices.',
      annotations: toolAnnotations({ title: 'Get account notifications', openWorld: true }),
    },
    async () => minifiedResult(parseNotifications(await client.fetchHtml('/members/'))),
  );
}
