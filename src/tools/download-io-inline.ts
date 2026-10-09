import type { DownloadContentBlock, DownloadIO } from './download.js';

// Cap on cumulative raw image bytes surfaced inline in a SINGLE tool result.
// Full-res artwork is ~0.7 MB each and base64 inflates it ~33%, so an unbounded
// portfolio pull (no `limit`, `resolution: full`) could return tens of MB in one
// MCP response. Images past the cap are dropped and summarised in a text note
// (narrow the pull — `project`/`grade` filters, a smaller `limit` or a lower
// `resolution` — to retrieve them).
//
// Why 10 MiB: mcp-host (the hosted runtime that runs this server for claude.ai)
// caps any single child result at 14 MiB of serialized JSON-RPC
// (CHILD_RESULT_MAX_BYTES, chrischall/mcp-host#952) and replaces anything larger
// with a generic "result too large" tool error. 10 MiB raw is ~13.3 MiB base64,
// which with the JSON-RPC envelope still fits under 14 MiB — so this check fires
// first and the model gets our clearer, actionable note instead. (claude.ai
// itself accepts images up to ~10 MB each; before #952, a result over 10 MiB
// killed the child process outright.)
export const MAX_INLINE_BYTES = 10 * 1024 * 1024; // 10 MiB raw (~13.3 MiB base64)

const MIB = 1024 * 1024;
const formatCap = (bytes: number): string =>
  bytes >= MIB ? `${+(bytes / MIB).toFixed(1)} MiB` : `${bytes} bytes`;

// Filesystem-free download I/O, for a deployment whose disk the user cannot
// reach. Image writes (`.jpg`) are accumulated and returned as base64 MCP image
// content blocks alongside the tool's JSON summary; directory creation and mtime
// setting are no-ops, and `.json` sidecars/index manifests are dropped (there is
// nowhere to put them — `persistsFiles:false` makes the tool omit the
// `index_file`/`metadata_count` fields rather than advertise files it never
// wrote). `exists()` always returns false, so `skip_existing` never skips
// (nothing persists between calls). Imports NO `node:fs`.
//
// One instance PER INVOCATION: `registerDownloadTools` calls `makeIO()` afresh
// for every `artsonia_download_artwork` call, so concurrent calls never share a
// buffer (a shared instance would let one call drain another's images). Do not
// refactor this into a single registered instance. `extraContent()` still
// DRAINS its buffer on read, as defence in depth: a reused instance would then
// return only its own images, never a prior call's.
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

  async writeFile(path: string, bytes: Buffer): Promise<void | 'omitted'> {
    // Only image bytes are surfaced inline; JSON sidecars/index have nowhere to
    // go here and are represented by the JSON summary instead.
    if (!/\.jpe?g$/i.test(path)) return;
    // Size guard: keep one inline response under the cap. An over-cap image is
    // dropped and counted so `extraContent()` can flag it rather than silently
    // truncate, and reported back as 'omitted' so the tool lists it as such
    // instead of as downloaded.
    if (this.bytes + bytes.length > this.maxInlineBytes) {
      this.omitted += 1;
      this.omittedBytes += bytes.length;
      return 'omitted';
    }
    this.bytes += bytes.length;
    this.images.push({ type: 'image', data: bytes.toString('base64'), mimeType: 'image/jpeg' });
  }

  async setMtime(_path: string, _mtime: Date): Promise<void> {
    /* no filesystem mtimes here */
  }

  extraContent(): DownloadContentBlock[] {
    // Drain (defence in depth): each instance serves one invocation, but
    // resetting here guarantees a reused instance could never leak a prior
    // call's bytes (or cap counters) into a later result.
    const out = this.images;
    if (this.omitted > 0) {
      const mb = Math.max(1, Math.round(this.omittedBytes / 1024 / 1024));
      out.push({
        type: 'text',
        text: `Note: ${this.omitted} image(s) (~${mb} MB) were omitted — one result can carry at most ${formatCap(this.maxInlineBytes)} of inline image data. To retrieve them, narrow the pull and re-run: filter with \`project\` or \`grade\`, use a smaller \`limit\` (it keeps the newest N), and/or a lower \`resolution\` (e.g. "large" or "medium" instead of "full").`,
      });
    }
    this.images = [];
    this.bytes = 0;
    this.omitted = 0;
    this.omittedBytes = 0;
    return out;
  }
}
