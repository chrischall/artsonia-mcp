import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { UNTRUSTED_DESCRIPTION_SUFFIX, toolAnnotations, untrustedResult } from '@chrischall/mcp-utils';
import type { ArtsoniaClient } from '../client.js';
import { parseFans } from '../parse.js';

export function registerFanTools(server: McpServer, client: ArtsoniaClient): void {
  server.registerTool(
    'artsonia_get_fans',
    {
      title: "Get a student's fan club",
      description: "List the fans (name + relationship) in a student's fan club. Pass the artist_id from artsonia_list_students. " + UNTRUSTED_DESCRIPTION_SUFFIX,
      annotations: toolAnnotations({ title: "Get a student's fan club", openWorld: true }),
      inputSchema: z.object({ artist_id: z.string().regex(/^\d+$/, 'must be a numeric id').describe('Student artist_id.') }),
    },
    async ({ artist_id }) => untrustedResult({ artist_id, fans: parseFans(await client.fetchHtml(`/members/fanclub/?artist=${artist_id}`)) }),
  );
}
