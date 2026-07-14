import type { DownloadContentBlock, DownloadIO } from './download.js';

// Filesystem-free download I/O for the hosted Cloudflare Worker, which has no
// disk. Image writes (`.jpg`) are accumulated and returned as base64 MCP image
// content blocks alongside the tool's JSON summary; directory creation and mtime
// setting are no-ops, and `.json` sidecars/index manifests are dropped (there is
// nowhere to put them — the summary already carries the same data). `exists()`
// always returns false, so `skip_existing` never skips (nothing persists between
// calls). Imports NO `node:fs`, so it is safe to bundle into the Worker.
export class InlineDownloadIO implements DownloadIO {
  private readonly images: DownloadContentBlock[] = [];

  async mkdirp(_dir: string): Promise<void> {
    /* no filesystem on the Worker */
  }

  exists(_path: string): boolean {
    return false;
  }

  async writeFile(path: string, bytes: Buffer): Promise<void> {
    // Only image bytes are surfaced inline; JSON sidecars/index have nowhere to
    // go on the Worker and are represented by the JSON summary instead.
    if (/\.jpe?g$/i.test(path)) {
      this.images.push({ type: 'image', data: bytes.toString('base64'), mimeType: 'image/jpeg' });
    }
  }

  async setMtime(_path: string, _mtime: Date): Promise<void> {
    /* no filesystem mtimes on the Worker */
  }

  extraContent(): DownloadContentBlock[] {
    return this.images;
  }
}
