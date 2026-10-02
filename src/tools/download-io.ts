import { mkdir, utimes } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { assertPathWithinRoots, writeFileSafe } from '@chrischall/mcp-utils';
import type { DownloadContentBlock, DownloadIO } from './download.js';

// Disk-backed download I/O for a local stdio/desktop install, where the server's
// filesystem IS the user's — this is the default (see `./make-download-io.ts`).
// It is the ONLY module in the download path that touches `node:fs`;
// `download.ts` imports it as a type only, so a hosted deployment running the
// inline IO never exercises `node:fs` through the download tool.
//
// Every folder it creates and every file it writes is confined to
// `allowedRoots` (chrischall/fleet-audit#985): `dest` is chosen by the model, so
// without this a prompt-injected path could drop files anywhere the process can
// write. Writes go through mcp-utils `writeFileSafe`, which also refuses a
// symlink planted at the target name instead of writing through it.
export class NodeDownloadIO implements DownloadIO {
  readonly persistsFiles = true;

  /** @param allowedRoots folders `dest` must resolve inside (see `downloadRoots`). */
  constructor(readonly allowedRoots: readonly string[]) {}

  async mkdirp(dir: string): Promise<void> {
    assertPathWithinRoots(dir, this.allowedRoots);
    await mkdir(dir, { recursive: true });
    // Re-check now it exists, in case a component was swapped for a symlink.
    assertPathWithinRoots(dir, this.allowedRoots);
  }

  exists(path: string): boolean {
    return existsSync(path);
  }

  async writeFile(path: string, bytes: Buffer): Promise<void> {
    // overwrite: skip_existing:false and re-written index.json/sidecars replace
    // a regular file; a symlink at `path` is refused either way.
    await writeFileSafe(path, bytes, { overwrite: true, allowedRoots: this.allowedRoots });
  }

  async setMtime(path: string, mtime: Date): Promise<void> {
    await utimes(path, mtime, mtime);
  }

  extraContent(): DownloadContentBlock[] {
    // Files are written to disk; nothing is returned inline.
    return [];
  }
}
