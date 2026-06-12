import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mkdir, writeFile, utimes } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { textResult, toolAnnotations, schemaConfirm, expandPath, messageOf, NumericIdString, mapWithConcurrency } from '@chrischall/mcp-utils';
import type { ArtsoniaClient } from '../client.js';
import { parsePortfolio, parseArtwork, parseFeedback, parseStudents, artworkImageUrl } from '../parse.js';

const DEFAULT_TEMPLATE = '{grade} - {project} - {title}';
export const FETCH_CONCURRENCY = 6;
const MAX_NAME_LEN = 150;

/** "Grade 6" / "grade 6" / "6" → "6"; "Grade K" → "k". */
function normalizeGrade(g: string | null | undefined): string {
  return (g ?? '').replace(/grade/i, '').trim().toLowerCase();
}

export interface FilenameFields {
  title?: string;
  project?: string;
  grade?: string | null;
  /** YYYY-MM-DD; only known after the image's Last-Modified is read. */
  date?: string;
}

/**
 * Resolve a filename template to a safe, unique `.jpg` name.
 * Tokens: {title} {project} {grade}(→"Grade N") {date} {artwork_id}. Empty tokens
 * and their surrounding " - " separators are dropped. The result is slugified for
 * filesystem safety, and the artwork_id is always appended (unless the template
 * already includes it) so names are guaranteed unique AND a pure function of the
 * artwork (→ idempotent re-runs). Untitled/empty → just the artwork_id.
 */
export function buildFilename(template: string, fields: FilenameFields, artworkId: string): string {
  const tokens: Record<string, string> = {
    title: fields.title?.trim() ?? '',
    project: fields.project?.trim() ?? '',
    grade: fields.grade ? `Grade ${fields.grade}` : '',
    date: fields.date ?? '',
    artwork_id: artworkId,
  };
  let name = template.replace(/\{(title|project|grade|date|artwork_id)\}/g, (_, k: string) => tokens[k] ?? '');
  // Collapse separators left by empty tokens, e.g. "Grade 6 -  - Title" → "Grade 6 - Title".
  let prev: string;
  do { prev = name; name = name.replace(/\s*-\s*-\s*/g, ' - '); } while (name !== prev);
  name = name.replace(/^[\s\-_]+|[\s\-_]+$/g, '');
  // Slugify: drop filesystem-unsafe chars + control chars + leading dots; collapse whitespace.
  name = name.replace(/[\/\\:*?"<>|\x00-\x1f]/g, '').replace(/^\.+/, '').replace(/\s+/g, ' ').trim();
  if (name.length > MAX_NAME_LEN) name = name.slice(0, MAX_NAME_LEN).trim();
  // Guarantee uniqueness + idempotency: every name carries the artwork_id in its
  // canonical "(id)" form unless the template already places the id explicitly.
  if (!template.includes('{artwork_id}') && !name.includes(`(${artworkId})`)) {
    name = name ? `${name} (${artworkId})` : artworkId;
  }
  if (!name) name = artworkId;
  return `${name}.jpg`;
}

interface Item {
  artwork_id: string;
  is_private: boolean;
  title?: string;
  project?: string;
  grade?: string | null;
  comments?: Array<{ author: string; text: string }>;
}
type Outcome =
  | { kind: 'downloaded'; artwork_id: string; file: string; bytes: number; date_source: 'last-modified' | 'download-time'; timestamp: string }
  | { kind: 'skipped'; artwork_id: string; file: string }
  | { kind: 'failed'; artwork_id: string; reason: string };

export function registerDownloadTools(server: McpServer, client: ArtsoniaClient): void {
  server.registerTool(
    'artsonia_download_artwork',
    {
      title: "Download a student's artwork images",
      description:
        "Download full-resolution images of a student's artwork to a local folder, named from the artwork title/project/grade and time-stamped to the image's source date. Optionally filter by class/project (substring), grade, and/or keep only the most-recent N (the portfolio is reliably newest-first). Re-runs are idempotent (skip_existing). Without confirm:true this is a DRY RUN that lists the resolved filenames with estimated bytes and writes nothing. write_metadata:true also saves each artwork's comments + teacher feedback as a .json sidecar next to its image. Note: descriptive filenames need each artwork's detail page (slower) — use filename_template \"{artwork_id}\" for the fast id-only path.",
      annotations: toolAnnotations({ title: "Download a student's artwork images", readOnly: false, openWorld: true }),
      inputSchema: {
        artist_id: NumericIdString.describe('Student artist_id (from artsonia_list_students).'),
        dest: z.string().min(1).describe('Local destination folder (a leading ~ is expanded). Created if missing.'),
        project: z.string().min(1).optional().describe('Only artworks whose school-project/class name contains this (case-insensitive).'),
        grade: z.string().min(1).optional().describe('Only artworks created in this grade, e.g. "6" or "Grade 6".'),
        limit: z.number().int().positive().optional().describe('Keep only the N most recent matching artworks (portfolio is newest-first).'),
        resolution: z.enum(['full', 'xlarge', 'large', 'medium', 'small']).default('full').describe('Image resolution. "full" is the original (~0.7 MB each).'),
        filename_template: z.string().min(1).default(DEFAULT_TEMPLATE).describe('Filename pattern. Tokens: {title} {project} {grade} {date} {artwork_id}. The artwork_id is auto-appended for uniqueness if absent. Use "{artwork_id}" for the fast id-only path (no detail fetch).'),
        set_mtime_from_source: z.boolean().default(true).describe("Set each file's modified time from the image's Last-Modified header (its Artsonia upload date) instead of the download moment."),
        skip_existing: z.boolean().default(true).describe('Skip artworks whose target file already exists (idempotent re-runs). Set false to overwrite.'),
        write_index: z.boolean().default(false).describe('After downloading, write an index.json manifest into the destination folder listing the downloaded items (artwork_id, title, file, grade, project, date). Off by default.'),
        write_metadata: z.boolean().default(false).describe("After downloading, write a per-artwork <image-name>.json sidecar next to each image with the artwork's comments and teacher feedback (plus title/project/grade). Fetches each artwork's detail page + the student's feedback page. Off by default."),
        include_private: z.boolean().default(true).describe('Include artworks marked private in the portfolio. Set false to exclude them (excluded count is reported as private_excluded_count).'),
        confirm: schemaConfirm,
      },
    },
    async ({ artist_id, dest, project, grade, limit, resolution, filename_template, set_mtime_from_source, skip_existing, write_index, write_metadata, include_private, confirm }) => {
      const template = filename_template;
      const templateUsesDate = /\{date\}/.test(template);
      // write_metadata needs each artwork's detail page anyway (for its comments),
      // so it rides the same up-front detail fetch as descriptive filenames — but
      // only on confirmed runs: previews discard comments, so dry-run keeps the
      // {artwork_id} fast path (review on #30).
      const needDetail =
        project !== undefined || grade !== undefined || /\{(title|project|grade)\}/.test(template) || (write_metadata && confirm === true);

      // 1. Portfolio → artwork ids (newest-first) + private flags.
      const allTiles = parsePortfolio(await client.fetchHtml(`/artists/portfolio.asp?id=${artist_id}`));
      const tiles = include_private ? allTiles : allTiles.filter((t) => !t.is_private);
      const privateExcluded = allTiles.length - tiles.length;
      let items: Item[] = tiles.map((t) => ({ artwork_id: t.artwork_id, is_private: t.is_private }));

      // 2. Detail fetch (for naming and/or project/grade filtering).
      if (needDetail) {
        const wantGrade = normalizeGrade(grade);
        // With a limit and no filter, only the newest N need a detail page — don't
        // fetch the whole portfolio just to throw most of it away.
        const tilesToDetail =
          limit !== undefined && project === undefined && grade === undefined ? tiles.slice(0, limit) : tiles;
        const detailed = await mapWithConcurrency(tilesToDetail, FETCH_CONCURRENCY, async (t): Promise<Item> => {
          const d = parseArtwork(await client.fetchHtml(`/museum/art.asp?id=${t.artwork_id}`));
          return {
            artwork_id: t.artwork_id,
            is_private: t.is_private,
            title: d.title,
            project: d.project,
            grade: d.grade,
            ...(write_metadata ? { comments: d.comments } : {}),
          };
        });
        items = detailed.filter(
          (it) =>
            (project === undefined || (it.project ?? '').toLowerCase().includes(project.toLowerCase())) &&
            (grade === undefined || normalizeGrade(it.grade) === wantGrade),
        );
      }

      // 3. Most-recent-N (no-op when already capped above; still needed for the filtered path).
      if (limit !== undefined) items = items.slice(0, limit);

      const destDir = expandPath(dest);
      const privateCount = items.filter((it) => it.is_private).length;

      // 4. Dry run — show resolved filenames (date-token names finalize at download
      // time) and estimated sizes. Sizes come from HEAD probes of the public image
      // CDN — read-only, never a body download, and a probe failure just leaves the
      // estimate out rather than failing the preview.
      if (confirm !== true) {
        const estimates = new Map<string, number>();
        await mapWithConcurrency(items, FETCH_CONCURRENCY, async (it) => {
          try {
            const res = await fetch(artworkImageUrl(it.artwork_id, resolution), { method: 'HEAD' });
            const len = Number(res.headers.get('content-length'));
            if (res.ok && Number.isFinite(len) && len > 0) estimates.set(it.artwork_id, len);
          } catch {
            /* estimate unavailable — preview must still succeed */
          }
        });
        const estimatedTotal = [...estimates.values()].reduce((a, b) => a + b, 0);
        return textResult({
          preview: true,
          action: 'download_artwork',
          note: `DRY RUN — would download ${items.length} image(s) at "${resolution}" resolution to ${destDir}. Re-run with confirm: true to download.`,
          count: items.length,
          private_count: privateCount,
          ...(privateExcluded > 0 ? { private_excluded_count: privateExcluded } : {}),
          ...(estimates.size > 0 ? { estimated_total_bytes: estimatedTotal } : {}),
          dest: destDir,
          resolution,
          filename_template: template,
          artworks: items.slice(0, 200).map((it) => ({
            artwork_id: it.artwork_id,
            is_private: it.is_private,
            ...(it.title !== undefined ? { title: it.title } : {}),
            ...(estimates.has(it.artwork_id) ? { estimated_bytes: estimates.get(it.artwork_id) } : {}),
            filename: templateUsesDate ? '(finalized with {date} at download)' : buildFilename(template, it, it.artwork_id),
          })),
        });
      }

      // 5. Download (bounded concurrency).
      await mkdir(destDir, { recursive: true });
      const outcomes = await mapWithConcurrency(items, FETCH_CONCURRENCY, async (it): Promise<Outcome> => {
        try {
          // Filenames without {date} are known up-front → skip before fetching.
          let file = templateUsesDate ? null : join(destDir, buildFilename(template, it, it.artwork_id));
          if (file && skip_existing && existsSync(file)) return { kind: 'skipped', artwork_id: it.artwork_id, file };

          const res = await fetch(artworkImageUrl(it.artwork_id, resolution));
          if (!res.ok) return { kind: 'failed', artwork_id: it.artwork_id, reason: `HTTP ${res.status}` };

          // Parse Last-Modified defensively — a malformed header must NOT fail the
          // download; it just falls back to download-time.
          const lastMod = res.headers.get('last-modified');
          const parsed = lastMod ? new Date(lastMod) : null;
          const sourceDate = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
          const date = sourceDate ? sourceDate.toISOString().slice(0, 10) : '';
          if (!file) {
            file = join(destDir, buildFilename(template, { ...it, date }, it.artwork_id));
            if (skip_existing && existsSync(file)) return { kind: 'skipped', artwork_id: it.artwork_id, file };
          }

          const buf = Buffer.from(await res.arrayBuffer());
          await writeFile(file, buf);
          // date_source / timestamp reflect the file's ACTUAL mtime.
          const fromSource = set_mtime_from_source && sourceDate !== null;
          if (fromSource) await utimes(file, sourceDate!, sourceDate!);
          return {
            kind: 'downloaded',
            artwork_id: it.artwork_id,
            file,
            bytes: buf.length,
            date_source: fromSource ? 'last-modified' : 'download-time',
            timestamp: (fromSource ? sourceDate! : new Date()).toISOString(),
          };
        } catch (e) {
          return { kind: 'failed', artwork_id: it.artwork_id, reason: messageOf(e) };
        }
      });

      const downloaded = outcomes.filter((o): o is Extract<Outcome, { kind: 'downloaded' }> => o.kind === 'downloaded');
      const skipped = outcomes.filter((o): o is Extract<Outcome, { kind: 'skipped' }> => o.kind === 'skipped');
      const failed = outcomes.filter((o): o is Extract<Outcome, { kind: 'failed' }> => o.kind === 'failed');
      const byId = new Map(items.map((it) => [it.artwork_id, it]));
      const isPrivate = (artworkId: string) => byId.get(artworkId)?.is_private ?? false;

      // 6. Optional sidecar manifest of what's on disk. Written whenever
      // write_index is requested (even if everything was skipped on a re-run),
      // so the response always carries index_file rather than silently omitting
      // it. Lists BOTH freshly-downloaded and already-present (skipped) items —
      // it's an inventory of what's in `dest`, not just this run's downloads.
      let indexFile: string | undefined;
      if (write_index) {
        const onDisk: Array<{ artwork_id: string; file: string; date?: string }> = [
          ...downloaded.map((d) => ({
            artwork_id: d.artwork_id,
            file: d.file,
            ...(d.date_source === 'last-modified' ? { date: d.timestamp.slice(0, 10) } : {}),
          })),
          ...skipped.map((s) => ({ artwork_id: s.artwork_id, file: s.file })),
        ];
        const manifest = {
          generated_at: new Date().toISOString(),
          count: onDisk.length,
          items: onDisk.map((o) => {
            const it = byId.get(o.artwork_id);
            return {
              artwork_id: o.artwork_id,
              file: basename(o.file),
              ...(it?.title !== undefined ? { title: it.title } : {}),
              ...(it?.project !== undefined ? { project: it.project } : {}),
              ...(it?.grade != null ? { grade: it.grade } : {}),
              ...(o.date !== undefined ? { date: o.date } : {}),
            };
          }),
        };
        indexFile = join(destDir, 'index.json');
        await writeFile(indexFile, JSON.stringify(manifest, null, 2));
      }

      // 7. Optional per-artwork metadata sidecars: <image-name>.json next to each
      // image (downloaded AND already-present), carrying the artwork's comments
      // (from its detail page — same source as artsonia_list_comments) and the
      // student's teacher feedback for it (same source as artsonia_get_feedback).
      let metadataCount: number | undefined;
      if (write_metadata) {
        const feedbackByArt = new Map<string, Array<{ message: string; posted_by: string; is_read: boolean }>>();
        for (const f of parseFeedback(await client.fetchHtml(`/members/feedback/?artist=${artist_id}`))) {
          if (!f.artwork_id) continue;
          const list = feedbackByArt.get(f.artwork_id) ?? [];
          list.push({ message: f.message, posted_by: f.posted_by, is_read: f.is_read });
          feedbackByArt.set(f.artwork_id, list);
        }
        const onDisk = [...downloaded, ...skipped];
        await mapWithConcurrency(onDisk, FETCH_CONCURRENCY, async (o) => {
          const it = byId.get(o.artwork_id);
          const sidecar = {
            artwork_id: o.artwork_id,
            ...(it?.title !== undefined ? { title: it.title } : {}),
            ...(it?.project !== undefined ? { project: it.project } : {}),
            ...(it?.grade != null ? { grade: it.grade } : {}),
            is_private: it?.is_private ?? false,
            image_file: basename(o.file),
            comments: it?.comments ?? [],
            feedback: feedbackByArt.get(o.artwork_id) ?? [],
          };
          await writeFile(o.file.replace(/\.jpg$/i, '.json'), JSON.stringify(sidecar, null, 2));
        });
        metadataCount = onDisk.length;
      }

      // 8. Post-run sanity check (unfiltered runs only): the dashboard's
      // artwork_count should equal what's now on disk — a mismatch flags a
      // silently-partial pull. Best-effort: a failed read never fails the run.
      let countCheck: { expected: number; on_disk: number; ok: boolean } | undefined;
      let warning: string | undefined;
      if (project === undefined && grade === undefined && limit === undefined && include_private) {
        try {
          const student = parseStudents(await client.fetchHtml('/members/')).find((s) => s.artist_id === artist_id);
          if (student && student.artwork_count !== null) {
            const onDiskCount = downloaded.length + skipped.length;
            countCheck = { expected: student.artwork_count, on_disk: onDiskCount, ok: onDiskCount === student.artwork_count };
            if (!countCheck.ok) {
              warning = `Sanity check: downloaded+skipped (${onDiskCount}) != the student's artwork_count (${student.artwork_count}) — this pull may be partial.`;
            }
          }
        } catch {
          /* best-effort check — never fail the download over it */
        }
      }

      return textResult({
        downloaded_count: downloaded.length,
        skipped_count: skipped.length,
        failed_count: failed.length,
        private_count: privateCount,
        ...(privateExcluded > 0 ? { private_excluded_count: privateExcluded } : {}),
        total_bytes: downloaded.reduce((sum, d) => sum + d.bytes, 0),
        dest: destDir,
        resolution,
        ...(warning ? { warning } : {}),
        ...(countCheck ? { count_check: countCheck } : {}),
        downloaded: downloaded.map(({ kind, ...rest }) => ({ ...rest, is_private: isPrivate(rest.artwork_id) })),
        ...(skipped.length ? { skipped: skipped.map(({ kind, ...rest }) => ({ ...rest, is_private: isPrivate(rest.artwork_id) })) } : {}),
        ...(failed.length ? { failed: failed.map(({ kind, ...rest }) => ({ ...rest, is_private: isPrivate(rest.artwork_id) })) } : {}),
        ...(indexFile ? { index_file: indexFile } : {}),
        ...(metadataCount !== undefined ? { metadata_count: metadataCount } : {}),
      });
    },
  );
}
