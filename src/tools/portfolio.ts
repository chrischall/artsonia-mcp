import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, toolAnnotations } from '@chrischall/mcp-utils';
import type { ArtsoniaClient } from '../client.js';
import { parsePortfolio, parseArtwork } from '../parse.js';

const NumericId = z.string().regex(/^\d+$/, 'must be a numeric id');

export function registerPortfolioTools(server: McpServer, client: ArtsoniaClient): void {
  server.registerTool(
    'artsonia_get_portfolio',
    {
      title: "Get a student's portfolio",
      description: "List a student's artworks (artwork_id, title, private flag, thumbnail). Pass the artist_id from artsonia_list_students.",
      annotations: toolAnnotations({ title: "Get a student's portfolio", openWorld: true }),
      inputSchema: { artist_id: NumericId.describe('Student artist_id (from artsonia_list_students).') },
    },
    async ({ artist_id }) => textResult({ artist_id, artworks: parsePortfolio(await client.fetchHtml(`/artists/portfolio.asp?id=${artist_id}`)) }),
  );
  server.registerTool(
    'artsonia_get_artwork',
    {
      title: 'Get artwork detail',
      description: 'Get one artwork: title, artist screen-name, view count, description, and the comments on it. Pass an artwork_id from a portfolio.',
      annotations: toolAnnotations({ title: 'Get artwork detail', openWorld: true }),
      inputSchema: { artwork_id: NumericId.describe('Artwork id (from artsonia_get_portfolio).') },
    },
    async ({ artwork_id }) => textResult(parseArtwork(await client.fetchHtml(`/museum/art.asp?id=${artwork_id}`))),
  );
  server.registerTool(
    'artsonia_list_comments',
    {
      title: 'List comments on an artwork',
      description: 'List the comments on a given artwork (author + text). Pass an artwork_id from a portfolio.',
      annotations: toolAnnotations({ title: 'List comments on an artwork', openWorld: true }),
      inputSchema: { artwork_id: NumericId.describe('Artwork id (from artsonia_get_portfolio).') },
    },
    async ({ artwork_id }) => {
      const detail = parseArtwork(await client.fetchHtml(`/museum/art.asp?id=${artwork_id}`));
      return textResult({ artwork_id, comments: detail.comments });
    },
  );
}
