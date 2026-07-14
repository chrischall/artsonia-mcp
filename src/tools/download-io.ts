import { mkdir, writeFile, utimes } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { DownloadContentBlock, DownloadIO } from './download.js';

// Disk-backed download I/O for the stdio/desktop server. This is the ONLY module
// in the download path that touches `node:fs`; `download.ts` imports it as a type
// only, so the hosted Cloudflare Worker (which injects the inline IO instead)
// never pulls `node:fs` in through the download tool.
export class NodeDownloadIO implements DownloadIO {
  readonly persistsFiles = true;

  async mkdirp(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  exists(path: string): boolean {
    return existsSync(path);
  }

  async writeFile(path: string, bytes: Buffer): Promise<void> {
    await writeFile(path, bytes);
  }

  async setMtime(path: string, mtime: Date): Promise<void> {
    await utimes(path, mtime, mtime);
  }

  extraContent(): DownloadContentBlock[] {
    // Files are written to disk; nothing is returned inline.
    return [];
  }
}
