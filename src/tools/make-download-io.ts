import { delimiter, join } from 'node:path';
import { parseBoolEnv, readEnvVar, type EnvSource } from '@chrischall/mcp-utils';
import type { DownloadIO } from './download.js';
import { NodeDownloadIO } from './download-io.js';
import { InlineDownloadIO } from './download-io-inline.js';

/** Local default download roots when ARTSONIA_OUTPUT_DIR is unset. */
export const DEFAULT_DOWNLOAD_ROOTS: readonly string[] = ['~/Downloads', '~/Pictures'];

/**
 * The folders `artsonia_download_artwork`'s `dest` must be inside on the disk IO
 * (chrischall/fleet-audit#985, #365). Confinement is always on:
 *
 * - `ARTSONIA_OUTPUT_DIR` set → exactly those folders (a path-delimiter list:
 *   `:` on macOS/Linux, `;` on Windows; `~` is expanded);
 * - unset, locally → `~/Downloads` and `~/Pictures`;
 * - unset, hosted (`MCP_DATA_DIR` set) → only `$MCP_DATA_DIR/downloads` — never
 *   the runner's home, and not the data dir itself (it holds the session cache).
 *
 * A blank or delimiter-only value counts as unset, so it can never disable it.
 */
export function downloadRoots(env: EnvSource = process.env): readonly string[] {
  const configured = (readEnvVar('ARTSONIA_OUTPUT_DIR', { env }) ?? '')
    .split(delimiter)
    .map((r) => r.trim())
    .filter(Boolean);
  if (configured.length > 0) return configured;
  const dataDir = readEnvVar('MCP_DATA_DIR', { env });
  if (dataDir) return [join(dataDir, 'downloads')];
  return DEFAULT_DOWNLOAD_ROOTS;
}

/**
 * Env-driven download-IO selector, the sibling of `makeTransport()`.
 *
 * Defaults to the disk-backed {@link NodeDownloadIO}: on a local stdio install
 * the server's filesystem IS the user's, so writing `dest` is exactly right and
 * must stay the default (silently switching would stop files appearing on disk).
 * It is confined to {@link downloadRoots}.
 *
 * `ARTSONIA_INLINE_DOWNLOADS=1` selects the filesystem-free
 * {@link InlineDownloadIO}, for a HOSTED deployment where the "filesystem" is the
 * runner's disk and the user can never reach it — there, returning the artwork as
 * inline base64 image blocks is the only way the bytes reach the caller at all.
 * It writes nothing, so `dest` is only a label and is not confined.
 *
 * Both implementations are cheap and side-effect free to construct, so unlike
 * `makeTransport()` this needs no dynamic import.
 */
export function makeDownloadIO(): DownloadIO {
  return parseBoolEnv('ARTSONIA_INLINE_DOWNLOADS') ? new InlineDownloadIO() : new NodeDownloadIO(downloadRoots());
}
