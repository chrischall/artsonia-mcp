import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, toolAnnotations } from '@chrischall/mcp-utils';
import type { ArtsoniaClient } from '../client.js';
import { parseFans } from '../parse.js';

export function registerFanTools(server: McpServer, client: ArtsoniaClient): void {
  server.registerTool(
    'artsonia_get_fans',
    {
      title: "Get a student's fan club",
      description: "List the fans (name + relationship) in a student's fan club. Pass the artist_id from artsonia_list_students.",
      annotations: toolAnnotations({ title: "Get a student's fan club", openWorld: true }),
      inputSchema: { artist_id: z.string().regex(/^\d+$/, 'must be a numeric id').describe('Student artist_id.') },
    },
    async ({ artist_id }) => textResult({ artist_id, fans: parseFans(await client.fetchHtml(`/members/fanclub/?artist=${artist_id}`)) }),
  );
}
