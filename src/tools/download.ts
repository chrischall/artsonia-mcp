import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { textResult, toolAnnotations, schemaConfirm, expandPath, messageOf } from '@chrischall/mcp-utils';
import type { ArtsoniaClient } from '../client.js';
import { parsePortfolio, parseArtwork, artworkImageUrl } from '../parse.js';

const NumericId = z.string().regex(/^\d+$/, 'must be a numeric id');

/** "Grade 6" / "grade 6" / "6" → "6"; "Grade K" → "k". */
function normalizeGrade(g: string | null | undefined): string {
  return (g ?? '').replace(/grade/i, '').trim().toLowerCase();
}

interface Selected { artwork_id: string; title?: string; project?: string; grade?: string | null }

export function registerDownloadTools(server: McpServer, client: ArtsoniaClient): void {
  server.registerTool(
    'artsonia_download_artwork',
    {
      title: "Download a student's artwork images",
      description:
        "Download full-resolution images of a student's artwork to a local folder. Optionally filter by class/project name (substring), by grade, and/or keep only the most-recent N (Artsonia exposes no real dates, but the portfolio is reliably newest-first). Without confirm:true this is a DRY RUN that lists what WOULD be downloaded and writes nothing. Note: project/grade filters require fetching each artwork's detail page (slower).",
      annotations: toolAnnotations({ title: "Download a student's artwork images", readOnly: false, openWorld: true }),
      inputSchema: {
        artist_id: NumericId.describe('Student artist_id (from artsonia_list_students).'),
        dest: z.string().min(1).describe('Local destination folder (a leading ~ is expanded). Created if missing.'),
        project: z.string().min(1).optional().describe('Only artworks whose school-project/class name contains this (case-insensitive).'),
        grade: z.string().min(1).optional().describe('Only artworks created in this grade, e.g. "6" or "Grade 6".'),
        limit: z.number().int().positive().optional().describe('Keep only the N most recent matching artworks (portfolio is newest-first).'),
        resolution: z.enum(['full', 'xlarge', 'large', 'medium', 'small']).default('full').describe('Image resolution. "full" is the original (~0.7 MB each).'),
        confirm: schemaConfirm,
      },
    },
    async ({ artist_id, dest, project, grade, limit, resolution, confirm }) => {
      // 1. Portfolio → artwork ids, newest-first.
      const tiles = parsePortfolio(await client.fetchHtml(`/artists/portfolio.asp?id=${artist_id}`));
      let items: Selected[] = tiles.map((t) => ({ artwork_id: t.artwork_id }));

      // 2. project/grade filters need each artwork's detail page.
      if (project !== undefined || grade !== undefined) {
        const wantGrade = normalizeGrade(grade);
        const matched: Selected[] = [];
        for (const t of tiles) {
          const d = parseArtwork(await client.fetchHtml(`/museum/art.asp?id=${t.artwork_id}`));
          const okProject = project === undefined || (d.project ?? '').toLowerCase().includes(project.toLowerCase());
          const okGrade = grade === undefined || normalizeGrade(d.grade) === wantGrade;
          if (okProject && okGrade) matched.push({ artwork_id: t.artwork_id, title: d.title, project: d.project, grade: d.grade });
        }
        items = matched;
      }

      // 3. Most-recent-N.
      if (limit !== undefined) items = items.slice(0, limit);

      const destDir = expandPath(dest);

      // 4. Dry run.
      if (confirm !== true) {
        return textResult({
          preview: true,
          action: 'download_artwork',
          note: `DRY RUN — would download ${items.length} image(s) at "${resolution}" resolution to ${destDir}. Re-run with confirm: true to download.`,
          count: items.length,
          dest: destDir,
          resolution,
          artworks: items.slice(0, 100),
        });
      }

      // 5. Download.
      await mkdir(destDir, { recursive: true });
      const downloaded: Array<{ artwork_id: string; file: string; bytes: number }> = [];
      const failed: Array<{ artwork_id: string; reason: string }> = [];
      for (const it of items) {
        try {
          const res = await fetch(artworkImageUrl(it.artwork_id, resolution));
          if (!res.ok) { failed.push({ artwork_id: it.artwork_id, reason: `HTTP ${res.status}` }); continue; }
          const buf = Buffer.from(await res.arrayBuffer());
          const file = join(destDir, `${it.artwork_id}.jpg`);
          await writeFile(file, buf);
          downloaded.push({ artwork_id: it.artwork_id, file, bytes: buf.length });
        } catch (e) {
          failed.push({ artwork_id: it.artwork_id, reason: messageOf(e) });
        }
      }
      return textResult({
        downloaded_count: downloaded.length,
        failed_count: failed.length,
        dest: destDir,
        resolution,
        downloaded,
        ...(failed.length ? { failed } : {}),
      });
    },
  );
}
