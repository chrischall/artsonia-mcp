import type { DownloadContentBlock, DownloadIO } from './download.js';

// Cap on cumulative raw image bytes surfaced inline in a SINGLE tool result.
// Full-res artwork is ~0.7 MB each and base64 inflates it ~33%, so an unbounded
// portfolio pull (no `limit`, `resolution: full`) could return tens of MB in one
// MCP response and blow past a host's response-size limit. Images past the cap
// are dropped and summarised in a text warning block (narrow the pull — a smaller
// `limit` or lower `resolution` — to retrieve them).
export const MAX_INLINE_BYTES = 24 * 1024 * 1024; // 24 MiB raw (~32 MiB base64)

// Filesystem-free download I/O, for a deployment whose disk the user cannot
// reach. Image writes (`.jpg`) are accumulated and returned as base64 MCP image
// content blocks alongside the tool's JSON summary; directory creation and mtime
// setting are no-ops, and `.json` sidecars/index manifests are dropped (there is
// nowhere to put them — `persistsFiles:false` makes the tool omit the
// `index_file`/`metadata_count` fields rather than advertise files it never
// wrote). `exists()` always returns false, so `skip_existing` never skips
// (nothing persists between calls). Imports NO `node:fs`.
//
// One instance is registered ONCE and REUSED across every
// `artsonia_download_artwork` invocation, so `extraContent()` DRAINS its buffer
// on read — each call returns only its own images, never a prior call's.
export class InlineDownloadIO implements DownloadIO {
  readonly persistsFiles = false;
  private images: DownloadContentBlock[] = [];
  private bytes = 0;
  private omitted = 0;
  private omittedBytes = 0;

  // `maxInlineBytes` is injectable purely so tests can exercise the cap without
  // allocating the multi-MB payload the production default would require.
  constructor(private readonly maxInlineBytes: number = MAX_INLINE_BYTES) {}

  async mkdirp(_dir: string): Promise<void> {
    /* no filesystem here */
  }

  exists(_path: string): boolean {
    return false;
  }

  async writeFile(path: string, bytes: Buffer): Promise<void> {
    // Only image bytes are surfaced inline; JSON sidecars/index have nowhere to
    // go here and are represented by the JSON summary instead.
    if (!/\.jpe?g$/i.test(path)) return;
    // Size guard: keep one inline response under the cap. An over-cap image is
    // dropped and counted so `extraContent()` can flag it rather than silently
    // truncate.
    if (this.bytes + bytes.length > this.maxInlineBytes) {
      this.omitted += 1;
      this.omittedBytes += bytes.length;
      return;
    }
    this.bytes += bytes.length;
    this.images.push({ type: 'image', data: bytes.toString('base64'), mimeType: 'image/jpeg' });
  }

  async setMtime(_path: string, _mtime: Date): Promise<void> {
    /* no filesystem mtimes here */
  }

  extraContent(): DownloadContentBlock[] {
    // Drain: each tool invocation must return only its own images. The instance
    // is shared for the session, so leaving state populated would leak prior
    // calls' bytes (and cap counters) into later results.
    const out = this.images;
    if (this.omitted > 0) {
      const mb = Math.max(1, Math.round(this.omittedBytes / 1024 / 1024));
      out.push({
        type: 'text',
        text: `Note: ${this.omitted} image(s) (~${mb} MB) exceeded the inline response size cap and were omitted. Re-run with a smaller \`limit\` or a lower \`resolution\` to retrieve them.`,
      });
    }
    this.images = [];
    this.bytes = 0;
    this.omitted = 0;
    this.omittedBytes = 0;
    return out;
  }
}
