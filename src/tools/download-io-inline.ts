import { basename } from 'node:path';
import type { EnvSource } from '@chrischall/mcp-utils';
import {
  EXPORT_BLOB_MAX_BYTES,
  blobStoreFromEnv,
  deliverFile,
  openExportSink,
  type BlobStore,
} from '@chrischall/mcp-utils/export';
import type { DownloadContentBlock, DownloadDelivery, DownloadIO, DeliveredVia } from './download.js';

// Cap on cumulative raw image bytes surfaced inline in a SINGLE tool result.
// Full-res artwork is ~0.7 MB each and base64 inflates it ~33%, so an unbounded
// portfolio pull (no `limit`, `resolution: full`) could return tens of MB in one
// MCP response.
//
// Why 10 MiB: mcp-host (the hosted runtime that runs this server for claude.ai)
// caps any single child result at 14 MiB of serialized JSON-RPC
// (CHILD_RESULT_MAX_BYTES, chrischall/mcp-host#952) and replaces anything larger
// with a generic "result too large" tool error. 10 MiB raw is ~13.3 MiB base64,
// which with the JSON-RPC envelope still fits under 14 MiB — so this check fires
// first and the model gets our clearer, actionable note instead.
export const MAX_INLINE_BYTES = 10 * 1024 * 1024; // 10 MiB raw (~13.3 MiB base64)

const MIB = 1024 * 1024;
const formatCap = (bytes: number): string =>
  bytes >= MIB ? `${+(bytes / MIB).toFixed(1)} MiB` : `${bytes} bytes`;

const NARROW =
  'Narrow the pull to get it: filter with `project` or `grade`, use a smaller `limit` (it keeps the newest N), and/or a lower `resolution` (e.g. "large" or "medium" instead of "full").';

/** Options for {@link InlineDownloadIO}. */
export interface InlineDownloadIOOptions {
  /** Where to read `MCP_BLOB_*` from (the blob store for links). Default `process.env`. */
  env?: EnvSource;
  /** Most raw bytes one call may put in its download archive. Default {@link EXPORT_BLOB_MAX_BYTES}. */
  archiveMaxBytes?: number;
}

interface Held {
  path: string;
  name: string;
  bytes: Buffer;
}

// Filesystem-free download I/O, for a deployment whose disk the user cannot
// reach (hosted on mcp-host, or ARTSONIA_INLINE_DOWNLOADS=1). Nothing a pull
// fetched is ever dropped silently; each image reaches the caller by the first
// route that works:
//
//  1. ONE image in the call → mcp-utils `deliverFile` (inline when it fits the
//     cap, else a signed blob link when hosted, else refused by reason);
//  2. several → inline up to the cap, and the overflow into ONE zip in the
//     blob store behind a signed link (`openExportSink`);
//  3. no blob store → an image past the cap is refused at `writeFile` with the
//     reason, so the tool lists it BY NAME as omitted.
//
// `.json` sidecars/index manifests are dropped (there is nowhere to put them —
// `persistsFiles:false` makes the tool omit `index_file`/`metadata_count`).
// `exists()` always returns false, so `skip_existing` never skips. Imports NO
// `node:fs`.
//
// One instance PER INVOCATION: `registerDownloadTools` calls `makeIO()` afresh
// for every call. `finish()` still DRAINS, as defence in depth.
export class InlineDownloadIO implements DownloadIO {
  readonly persistsFiles = false;
  private readonly store: BlobStore | undefined;
  private readonly env: EnvSource | undefined;
  private readonly archiveMaxBytes: number;
  private inline: Held[] = [];
  private overflow: Held[] = [];
  private inlineBytes = 0;
  private overflowBytes = 0;
  private refused: Array<{ name: string; reason: string }> = [];

  // `maxInlineBytes` is injectable so tests can exercise the cap without
  // allocating the multi-MB payload the production default would require.
  constructor(
    private readonly maxInlineBytes: number = MAX_INLINE_BYTES,
    opts: InlineDownloadIOOptions = {},
  ) {
    this.env = opts.env;
    this.store = blobStoreFromEnv(opts.env ?? process.env);
    this.archiveMaxBytes = opts.archiveMaxBytes ?? EXPORT_BLOB_MAX_BYTES;
  }

  async mkdirp(_dir: string): Promise<void> {
    /* no filesystem here */
  }

  exists(_path: string): boolean {
    return false;
  }

  async writeFile(path: string, bytes: Buffer, name: string = basename(path)): Promise<void | { omitted: string }> {
    // Only image bytes are delivered; JSON sidecars/index have nowhere to go.
    if (!/\.jpe?g$/i.test(path)) return;
    const held = { path, name, bytes };
    if (this.inlineBytes + bytes.length <= this.maxInlineBytes) {
      this.inlineBytes += bytes.length;
      this.inline.push(held);
      return;
    }
    if (!this.store) {
      const reason = `${formatCap(bytes.length)} would take this result past the ${formatCap(this.maxInlineBytes)} inline limit, and this server has no blob store to return a download link. ${NARROW}`;
      this.refused.push({ name, reason });
      return { omitted: reason };
    }
    if (this.overflowBytes + bytes.length > this.archiveMaxBytes) {
      const reason = `the download archive for this call is full (${formatCap(this.archiveMaxBytes)} limit). ${NARROW}`;
      this.refused.push({ name, reason });
      return { omitted: reason };
    }
    this.overflowBytes += bytes.length;
    this.overflow.push(held);
  }

  async setMtime(_path: string, _mtime: Date): Promise<void> {
    /* no filesystem mtimes here */
  }

  async finish(): Promise<DownloadDelivery> {
    const inline = this.inline;
    const overflow = this.overflow;
    const refused = this.refused;
    this.inline = [];
    this.overflow = [];
    this.refused = [];
    this.inlineBytes = 0;
    this.overflowBytes = 0;

    const content: DownloadContentBlock[] = [];
    const via = new Map<string, DeliveredVia>();
    const undelivered = new Map<string, string>();
    const failedNames: Array<{ name: string; reason: string }> = [...refused];
    let archive: DownloadDelivery['archive'];

    const all = [...inline, ...overflow];
    if (all.length === 1) {
      // A single image: the shared ladder (inline → signed link → too_large).
      const one = all[0]!;
      try {
        const d = await deliverFile({
          bytes: one.bytes,
          fileName: basename(one.name),
          mimeType: 'image/jpeg',
          store: this.store ?? null,
          keyPrefix: 'artwork',
          inlineMaxBytes: this.maxInlineBytes,
        });
        for (const block of d.content) {
          if (block.type === 'image') content.push(block);
        }
        via.set(one.path, d.via === 'link' ? { via: 'link', url: d.url!, expires_at: d.expiresAt! } : { via: 'inline' });
      } catch (e) {
        const reason = `could not be delivered: ${e instanceof Error ? e.message : String(e)}`;
        undelivered.set(one.path, reason);
        failedNames.push({ name: one.name, reason });
      }
    } else {
      for (const h of inline) {
        content.push({ type: 'image', data: h.bytes.toString('base64'), mimeType: 'image/jpeg' });
        via.set(h.path, { via: 'inline' });
      }
      if (overflow.length) archive = await this.zip(overflow, via, undelivered, failedNames);
    }

    if (archive) {
      content.push({
        type: 'text',
        text: `${archive.file_count} image(s) did not fit inline (${formatCap(this.maxInlineBytes)} per result), so they are in one zip: ${archive.url} (expires ${archive.expires_at}). Give the link to the user; anyone holding it can download until it expires.`,
      });
    }
    if (failedNames.length) {
      content.push({
        type: 'text',
        text: `Note: ${failedNames.length} image(s) were NOT delivered:\n${failedNames.map((f) => `- ${f.name}: ${f.reason}`).join('\n')}`,
      });
    }
    return { content, via, undelivered, ...(archive ? { archive } : {}) };
  }

  /** Zip `items` into one blob-store archive; record each item's route or reason. */
  private async zip(
    items: Held[],
    via: Map<string, DeliveredVia>,
    undelivered: Map<string, string>,
    failedNames: Array<{ name: string; reason: string }>,
  ): Promise<DownloadDelivery['archive']> {
    const fail = (h: Held, reason: string) => {
      undelivered.set(h.path, reason);
      failedNames.push({ name: h.name, reason });
    };
    const added: Held[] = [];
    try {
      const sink = await openExportSink({
        name: 'artsonia-mcp',
        envVar: 'ARTSONIA_OUTPUT_DIR',
        baseName: 'artsonia-artwork',
        maxBytes: this.archiveMaxBytes,
        ...(this.env ? { env: this.env } : {}),
      });
      for (const h of items) {
        try {
          await sink.addFile(h.name, h.bytes, 'image/jpeg');
          added.push(h);
        } catch (e) {
          fail(h, `could not be added to the download archive: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (!added.length) return undefined;
      const loc = await sink.finish();
      for (const h of added) via.set(h.path, { via: 'archive', name: h.name });
      return {
        url: loc.location,
        expires_at: loc.urlExpiresAt!,
        file_count: added.length,
        bytes: loc.bytes,
        archive_bytes: loc.archiveBytes!,
      };
    } catch (e) {
      const reason = `the download archive upload failed: ${e instanceof Error ? e.message : String(e)}`;
      for (const h of items) if (!undelivered.has(h.path)) fail(h, reason);
      return undefined;
    }
  }
}
