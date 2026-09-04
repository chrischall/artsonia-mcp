import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { join, basename, dirname, relative } from 'node:path';
import { NumericIdString, expandPath, mapWithConcurrency, messageOf, minifiedResult, schemaConfirm, toolAnnotations } from '@chrischall/mcp-utils';
import type { ArtsoniaClient } from '../client.js';
import { parsePortfolio, parseArtwork, parseFeedback, parseStudents, artworkImageUrl } from '../parse.js';

/**
 * An extra MCP content block the download IO can append to the tool result: an
 * inline image (the inline IO's base64 artwork bytes) or a text note (e.g. its
 * "images omitted — over the response cap" warning).
 */
export type DownloadContentBlock =
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'text'; text: string };

/**
 * The filesystem operations `artsonia_download_artwork` needs, abstracted so a
 * hosted deployment can supply an inline (no-disk) implementation. `node:fs`
 * lives ONLY behind this boundary — `download.ts` imports none of it — so a
 * server whose disk the user can't reach can register the download tool with an
 * IO that returns image bytes as MCP content blocks instead of writing them
 * somewhere unreachable. `./make-download-io.ts` picks the implementation:
 * the disk-backed `NodeDownloadIO` (`./download-io.ts`) by default, or the
 * `InlineDownloadIO` (`./download-io-inline.ts`) under
 * `ARTSONIA_INLINE_DOWNLOADS`.
 */
export interface DownloadIO {
  /**
   * Whether `writeFile` persists to a location the caller can later retrieve.
   * The disk IO is `true`; the inline IO is `false` (image bytes are returned
   * inline, but `.json` sidecars/`index.json` have nowhere to go). When
   * `false`, the tool omits the `index_file`/`metadata_count` fields rather than
   * advertise files it never wrote (honesty contract — see CLAUDE.md).
   */
  readonly persistsFiles: boolean;
  /** Create `dir` and any missing parents (recursive mkdir). */
  mkdirp(dir: string): Promise<void>;
  /** Whether a file already exists at `path` (drives `skip_existing`). */
  exists(path: string): boolean;
  /** Persist `bytes` at `path` (an image `.jpg` or a `.json` sidecar/index). */
  writeFile(path: string, bytes: Buffer): Promise<void>;
  /** Set `path`'s modified time (no-op where filesystem mtimes don't apply). */
  setMtime(path: string, mtime: Date): Promise<void>;
  /**
   * MCP content blocks to append to the tool result. The disk IO returns `[]`;
   * the inline IO returns each written image as a base64 image block.
   */
  extraContent(): DownloadContentBlock[];
}

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

/** School year a YYYY-MM-DD date falls in (July–June), e.g. "2021-2022". */
function schoolYear(date: string | undefined): string {
  const m = date?.match(/^(\d{4})-(\d{2})/);
  if (!m) return '';
  const [y, mo] = [Number(m[1]), Number(m[2])];
  return mo >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

function tokenMap(fields: FilenameFields, artworkId: string): Record<string, string> {
  return {
    title: fields.title?.trim() ?? '',
    project: fields.project?.trim() ?? '',
    grade: fields.grade ? `Grade ${fields.grade}` : '',
    date: fields.date ?? '',
    school_year: schoolYear(fields.date),
    artwork_id: artworkId,
  };
}

const TOKEN_RE = /\{(title|project|grade|date|school_year|artwork_id)\}/g;

/**
 * Substitute tokens into one name/path segment and slugify it: collapse the
 * " - " separators left by empty tokens, drop filesystem-unsafe + control
 * chars + leading dots ("." / ".." can never escape dest), trim, cap length.
 */
function resolveSegment(template: string, tokens: Record<string, string>): string {
  let name = template.replace(TOKEN_RE, (_, k: string) => tokens[k] ?? '');
  // Collapse separators left by empty tokens, e.g. "Grade 6 -  - Title" → "Grade 6 - Title".
  let prev: string;
  do { prev = name; name = name.replace(/\s*-\s*-\s*/g, ' - '); } while (name !== prev);
  name = name.replace(/^[\s\-_]+|[\s\-_]+$/g, '');
  // Slugify: drop filesystem-unsafe chars + control chars + leading dots; collapse whitespace.
  name = name.replace(/[\/\\:*?"<>|\x00-\x1f]/g, '').replace(/^\.+/, '').replace(/\s+/g, ' ').trim();
  if (name.length > MAX_NAME_LEN) name = name.slice(0, MAX_NAME_LEN).trim();
  return name;
}

/**
 * Resolve a filename template to a safe, unique `.jpg` name.
 * Tokens: {title} {project} {grade}(→"Grade N") {date} {school_year} {artwork_id}.
 * Empty tokens and their surrounding " - " separators are dropped. The result is
 * slugified for filesystem safety, and the artwork_id is always appended (unless
 * the template already includes it) so names are guaranteed unique AND a pure
 * function of the artwork (→ idempotent re-runs). Untitled/empty → just the
 * artwork_id.
 */
export function buildFilename(template: string, fields: FilenameFields, artworkId: string): string {
  let name = resolveSegment(template, tokenMap(fields, artworkId));
  // Guarantee uniqueness + idempotency: every name carries the artwork_id in its
  // canonical "(id)" form unless the template already places the id explicitly.
  if (!template.includes('{artwork_id}') && !name.includes(`(${artworkId})`)) {
    name = name ? `${name} (${artworkId})` : artworkId;
  }
  if (!name) name = artworkId;
  return `${name}.jpg`;
}

/**
 * Resolve a path template (issue #14) into slugified subfolder segments under
 * dest. Same tokens + slugification as buildFilename; segments that resolve
 * empty are dropped (no empty folders), so e.g. "{grade}/{project}/" with no
 * grade collapses to just the project. Deterministic → idempotent re-runs.
 */
export function buildRelPath(template: string, fields: FilenameFields, artworkId: string): string[] {
  const tokens = tokenMap(fields, artworkId);
  return template.split('/').map((seg) => resolveSegment(seg, tokens)).filter((seg) => seg.length > 0);
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
  | { kind: 'downloaded'; artwork_id: string; file: string; bytes: number; date_source: 'last-modified' | 'download-time'; timestamp: string; embedded?: boolean }
  | { kind: 'skipped'; artwork_id: string; file: string }
  | { kind: 'failed'; artwork_id: string; reason: string };

/**
 * `makeIO` is called ONCE PER INVOCATION, not once per registration. A
 * filesystem-free IO accumulates image bytes and drains them on read, so a
 * shared instance would let two concurrent `artsonia_download_artwork` calls
 * interleave and one drain the other's images.
 */
export function registerDownloadTools(
  server: McpServer,
  client: ArtsoniaClient,
  makeIO: () => DownloadIO,
): void {
  server.registerTool(
    'artsonia_download_artwork',
    {
      title: "Download a student's artwork images",
      description:
        "Download full-resolution images of a student's artwork to a local folder, named from the artwork title/project/grade and time-stamped to the image's source date. Optionally filter by class/project (substring), grade, and/or keep only the most-recent N (the portfolio is reliably newest-first). Re-runs are idempotent (skip_existing). Without confirm:true this is a DRY RUN that lists the resolved filenames with estimated bytes and writes nothing. write_metadata:true also saves each artwork's comments + teacher feedback as a .json sidecar next to its image. embed_metadata:true embeds title/project/grade/date into each JPEG's EXIF/IPTC. path_template (e.g. \"{grade}/{project}\" or \"{school_year}\") organizes downloads into subfolders for multi-year archives. Note: descriptive filenames need each artwork's detail page (slower) — use filename_template \"{artwork_id}\" for the fast id-only path.",
      annotations: toolAnnotations({ title: "Download a student's artwork images", readOnly: false, openWorld: true }),
      inputSchema: {
        artist_id: NumericIdString.describe('Student artist_id (from artsonia_list_students).'),
        dest: z.string().min(1).describe('Local destination folder (a leading ~ is expanded). Created if missing.'),
        project: z.string().min(1).optional().describe('Only artworks whose school-project/class name contains this (case-insensitive).'),
        grade: z.string().min(1).optional().describe('Only artworks created in this grade, e.g. "6" or "Grade 6".'),
        limit: z.number().int().positive().optional().describe('Keep only the N most recent matching artworks (portfolio is newest-first).'),
        resolution: z.enum(['full', 'xlarge', 'large', 'medium', 'small']).default('full').describe('Image resolution. "full" is the original (~0.7 MB each).'),
        filename_template: z.string().min(1).default(DEFAULT_TEMPLATE).describe('Filename pattern. Tokens: {title} {project} {grade} {date} {school_year} {artwork_id}. The artwork_id is auto-appended for uniqueness if absent. Use "{artwork_id}" for the fast id-only path (no detail fetch).'),
        path_template: z.string().min(1).optional().describe('Optional subfolder pattern under dest, composed with filename_template — e.g. "{grade}/{project}" or "{school_year}" for multi-year archives. Same tokens as filename_template; segments are slugified like filenames and empty tokens collapse (no empty folders). Paths are deterministic, so skip_existing re-runs stay idempotent. {school_year} (July–June, e.g. "2021-2022") derives from the image\'s Last-Modified.'),
        set_mtime_from_source: z.boolean().default(true).describe("Set each file's modified time from the image's Last-Modified header (its Artsonia upload date) instead of the download moment."),
        skip_existing: z.boolean().default(true).describe('Skip artworks whose target file already exists (idempotent re-runs). Set false to overwrite.'),
        write_index: z.boolean().default(false).describe('After downloading, write an index.json manifest into the destination folder listing the downloaded items (artwork_id, title, file, grade, project, date). Off by default.'),
        write_metadata: z.boolean().default(false).describe("After downloading, write a per-artwork <image-name>.json sidecar next to each image with the artwork's comments and teacher feedback (plus title/project/grade). Fetches each artwork's detail page + the student's feedback page. Off by default."),
        embed_metadata: z.boolean().default(false).describe("Embed each image's title/project/grade and source date (its Last-Modified, same as date_source) into the JPEG's EXIF (ImageDescription, DateTimeOriginal) and IPTC (title, keywords, date) so the metadata survives renames/moves and is searchable in Spotlight/Apple Photos. Needs each artwork's detail page (slower); applies to freshly downloaded files only (skipped files are left untouched). Off by default."),
        include_private: z.boolean().default(true).describe('Include artworks marked private in the portfolio. Set false to exclude them (excluded count is reported as private_excluded_count).'),
        confirm: schemaConfirm,
      },
    },
    async ({ artist_id, dest, project, grade, limit, resolution, filename_template, path_template, set_mtime_from_source, skip_existing, write_index, write_metadata, embed_metadata, include_private, confirm }) => {
      const template = filename_template;
      const templates = `${template}\n${path_template ?? ''}`;
      // {date}/{school_year} anywhere in the name or path → the target path is
      // only known once the image's Last-Modified has been read.
      const deferredNaming = /\{(date|school_year)\}/.test(templates);
      // One IO PER INVOCATION, not one shared across calls: a filesystem-free
      // IO buffers image bytes and `extraContent()` drains them on read, so a
      // shared instance would replay this call's images into the next one's
      // result (and let concurrent calls drain each other).
      const io = makeIO();
      // write_metadata needs each artwork's detail page anyway (for its comments)
      // and embed_metadata needs title/project/grade for the EXIF/IPTC fields, so
      // both ride the same up-front detail fetch as descriptive names — but only
      // on confirmed runs: previews don't use that data, so dry-run keeps the
      // {artwork_id} fast path (review on #30).
      // write_metadata only earns a detail fetch where its sidecars can actually
      // be written (io.persistsFiles); on the inline IO they're dropped,
      // so skip the fetch. embed_metadata still needs detail (it embeds into the
      // returned image bytes, which works on either IO).
      const needDetail =
        project !== undefined ||
        grade !== undefined ||
        /\{(title|project|grade)\}/.test(templates) ||
        (((write_metadata && io.persistsFiles) || embed_metadata) && confirm === true);

      /** Full target path for an item (subfolders from path_template + filename). */
      const fileOf = (it: Item, date: string): string => {
        const fields = { ...it, date };
        const segments = path_template ? buildRelPath(path_template, fields, it.artwork_id) : [];
        return join(destDir, ...segments, buildFilename(template, fields, it.artwork_id));
      };

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
        return minifiedResult({
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
          ...(path_template !== undefined ? { path_template } : {}),
          artworks: items.slice(0, 200).map((it) => ({
            artwork_id: it.artwork_id,
            is_private: it.is_private,
            ...(it.title !== undefined ? { title: it.title } : {}),
            ...(estimates.has(it.artwork_id) ? { estimated_bytes: estimates.get(it.artwork_id) } : {}),
            filename: deferredNaming ? '(finalized from the image date at download)' : relative(destDir, fileOf(it, '')),
          })),
        });
      }

      // 5. Download (bounded concurrency).
      await io.mkdirp(destDir);
      const outcomes = await mapWithConcurrency(items, FETCH_CONCURRENCY, async (it): Promise<Outcome> => {
        try {
          // Names/paths without {date}/{school_year} are known up-front → skip before fetching.
          let file = deferredNaming ? null : fileOf(it, '');
          if (file && skip_existing && io.exists(file)) return { kind: 'skipped', artwork_id: it.artwork_id, file };

          const res = await fetch(artworkImageUrl(it.artwork_id, resolution));
          if (!res.ok) return { kind: 'failed', artwork_id: it.artwork_id, reason: `HTTP ${res.status}` };

          // Parse Last-Modified defensively — a malformed header must NOT fail the
          // download; it just falls back to download-time.
          const lastMod = res.headers.get('last-modified');
          const parsed = lastMod ? new Date(lastMod) : null;
          const sourceDate = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
          const date = sourceDate ? sourceDate.toISOString().slice(0, 10) : '';
          if (!file) {
            file = fileOf(it, date);
            if (skip_existing && io.exists(file)) return { kind: 'skipped', artwork_id: it.artwork_id, file };
          }

          let buf: Buffer = Buffer.from(await res.arrayBuffer());
          // Best-effort EXIF/IPTC embed (lazy import — the default path never
          // evaluates the writer). A failed embed writes the original bytes.
          let embedded: boolean | undefined;
          if (embed_metadata) {
            try {
              const { embedJpegMetadata } = await import('./embed.js');
              buf = embedJpegMetadata(buf, { title: it.title, project: it.project, grade: it.grade, date: sourceDate ?? undefined });
              embedded = true;
            } catch {
              embedded = false;
            }
          }
          if (path_template !== undefined) await io.mkdirp(dirname(file));
          await io.writeFile(file, buf);
          // date_source / timestamp reflect the file's ACTUAL mtime.
          const fromSource = set_mtime_from_source && sourceDate !== null;
          if (fromSource) await io.setMtime(file, sourceDate!);
          return {
            kind: 'downloaded',
            artwork_id: it.artwork_id,
            file,
            bytes: buf.length,
            date_source: fromSource ? 'last-modified' : 'download-time',
            timestamp: (fromSource ? sourceDate! : new Date()).toISOString(),
            ...(embedded !== undefined ? { embedded } : {}),
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
      // write_index is requested on a persisting IO (even if everything was
      // skipped on a re-run), so the response always carries index_file rather
      // than silently omitting it. Lists BOTH freshly-downloaded and
      // already-present (skipped) items — it's an inventory of what's in `dest`,
      // not just this run's downloads. Skipped entirely on the inline IO
      // (no filesystem): index_file is then omitted, not advertised unwritten.
      let indexFile: string | undefined;
      if (write_index && io.persistsFiles) {
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
              // dest-relative so path_template subfolders survive in the manifest
              // (equals the bare filename for flat layouts).
              file: relative(destDir, o.file),
              ...(it?.title !== undefined ? { title: it.title } : {}),
              ...(it?.project !== undefined ? { project: it.project } : {}),
              ...(it?.grade != null ? { grade: it.grade } : {}),
              ...(o.date !== undefined ? { date: o.date } : {}),
            };
          }),
        };
        indexFile = join(destDir, 'index.json');
        await io.writeFile(indexFile, Buffer.from(JSON.stringify(manifest, null, 2)));
      }

      // 7. Optional per-artwork metadata sidecars: <image-name>.json next to each
      // image (downloaded AND already-present), carrying the artwork's comments
      // (from its detail page — same source as artsonia_list_comments) and the
      // student's teacher feedback for it (same source as artsonia_get_feedback).
      // Skipped on the inline IO (no reachable filesystem): metadata_count is then
      // omitted rather than reported for sidecars that were never written.
      let metadataCount: number | undefined;
      if (write_metadata && io.persistsFiles) {
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
          await io.writeFile(o.file.replace(/\.jpg$/i, '.json'), Buffer.from(JSON.stringify(sidecar, null, 2)));
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

      const result = minifiedResult({
        downloaded_count: downloaded.length,
        skipped_count: skipped.length,
        failed_count: failed.length,
        private_count: privateCount,
        ...(privateExcluded > 0 ? { private_excluded_count: privateExcluded } : {}),
        total_bytes: downloaded.reduce((sum, d) => sum + d.bytes, 0),
        ...(io.persistsFiles ? { dest: destDir } : {}),
        resolution,
        ...(warning ? { warning } : {}),
        ...(countCheck ? { count_check: countCheck } : {}),
        downloaded: downloaded.map(({ kind, file, ...rest }) => ({
          ...rest,
          // A file path only means something to the caller if a file was
          // actually written somewhere they can reach.
          ...(io.persistsFiles ? { file } : {}),
          is_private: isPrivate(rest.artwork_id),
        })),
        ...(skipped.length
          ? {
              skipped: skipped.map(({ kind, file, ...rest }) => ({
                ...rest,
                ...(io.persistsFiles ? { file } : {}),
                is_private: isPrivate(rest.artwork_id),
              })),
            }
          : {}),
        ...(failed.length ? { failed: failed.map(({ kind, ...rest }) => ({ ...rest, is_private: isPrivate(rest.artwork_id) })) } : {}),
        ...(indexFile ? { index_file: indexFile } : {}),
        ...(metadataCount !== undefined ? { metadata_count: metadataCount } : {}),
        ...(embed_metadata ? { embedded_count: downloaded.filter((d) => d.embedded).length } : {}),
      });
      // A filesystem-free DownloadIO returns the downloaded image bytes as MCP
      // content blocks, appended alongside the JSON summary. The disk-backed
      // NodeDownloadIO returns [] here (the files are on disk), so its result is
      // unchanged.
      const extra = io.extraContent();
      if (extra.length) result.content.push(...extra);
      return result;
    },
  );
}
