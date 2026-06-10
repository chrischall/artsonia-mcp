import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, toolAnnotations } from '@chrischall/mcp-utils';
import type { ArtsoniaClient } from '../client.js';
import { parsePortfolio, parseArtwork } from '../parse.js';
import { mapLimit, FETCH_CONCURRENCY } from './download.js';

const NumericId = z.string().regex(/^\d+$/, 'must be a numeric id');

export function registerPortfolioTools(server: McpServer, client: ArtsoniaClient): void {
  server.registerTool(
    'artsonia_get_portfolio',
    {
      title: "Get a student's portfolio",
      description:
        "List a student's artworks (artwork_id, is_private flag, thumbnail). Pass the artist_id from artsonia_list_students. Set include_details:true to also fetch each artwork's full detail (title, project, grade, views, …) in one call — this fetches a detail page per artwork (slower), so leave it off when the lean tiles are enough.",
      annotations: toolAnnotations({ title: "Get a student's portfolio", openWorld: true }),
      inputSchema: {
        artist_id: NumericId.describe('Student artist_id (from artsonia_list_students).'),
        include_details: z
          .boolean()
          .default(false)
          .describe('Fetch each artwork\'s full detail (title/project/grade/views/…) concurrently and merge it into the rows. Off by default (lean tiles, one request).'),
      },
    },
    async ({ artist_id, include_details }) => {
      const tiles = parsePortfolio(await client.fetchHtml(`/artists/portfolio.asp?id=${artist_id}`));
      if (!include_details) return textResult({ artist_id, artworks: tiles });
      const artworks = await mapLimit(tiles, FETCH_CONCURRENCY, async (tile) => {
        const detail = parseArtwork(await client.fetchHtml(`/museum/art.asp?id=${tile.artwork_id}`));
        return { ...tile, ...detail };
      });
      return textResult({ artist_id, artworks });
    },
  );
  server.registerTool(
    'artsonia_get_artwork',
    {
      title: 'Get artwork detail',
      description: 'Get one artwork: title, artist screen-name, view count, project (assignment name), and the comments on it. Pass an artwork_id from a portfolio.',
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
