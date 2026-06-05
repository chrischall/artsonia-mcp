import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, toolAnnotations } from '@chrischall/mcp-utils';
import type { ArtsoniaClient } from '../client.js';
import { parseAwards, parseProfile } from '../parse.js';

export function registerAccountTools(server: McpServer, client: ArtsoniaClient): void {
  server.registerTool(
    'artsonia_get_awards',
    {
      title: "Get a student's awards & activities",
      description:
        "List a student's Artsonia awards/achievement badges — current-year badges (name, earned/not, criteria, progress) plus badges earned in prior years. Pass the artist_id from artsonia_list_students.",
      annotations: toolAnnotations({ title: "Get a student's awards & activities", readOnly: true, openWorld: true }),
      inputSchema: { artist_id: z.string().regex(/^\d+$/, 'must be a numeric id').describe('Student artist_id (from artsonia_list_students).') },
    },
    async ({ artist_id }) => {
      const awards = parseAwards(await client.fetchHtml(`/artists/awards.asp?id=${artist_id}`));
      return textResult({
        artist_id,
        earned_count: awards.filter((a) => a.earned).length,
        awards,
      });
    },
  );

  server.registerTool(
    'artsonia_get_profile',
    {
      title: 'Get your account profile',
      description:
        'Show your Artsonia parent/fan account profile: name, email, mobile, and current notification opt-in states (news / artist activity / promos). Read-only complement to artsonia_set_notifications.',
      annotations: toolAnnotations({ title: 'Get your account profile', readOnly: true, openWorld: true }),
      inputSchema: {},
    },
    async () => textResult(parseProfile(await client.fetchHtml('/members/profile/'))),
  );
}
