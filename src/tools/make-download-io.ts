import { delimiter, join } from 'node:path';
import { parseBoolEnv, readEnvVar, type EnvSource } from '@chrischall/mcp-utils';
import type { DownloadIO } from './download.js';
import { NodeDownloadIO } from './download-io.js';
import { isHostedEnv } from '@chrischall/mcp-utils/export';
import { InlineDownloadIO, MAX_INLINE_BYTES } from './download-io-inline.js';

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
 * The filesystem-free {@link InlineDownloadIO} is used when
 * `ARTSONIA_INLINE_DOWNLOADS=1`, AND on any hosted deployment (`MCP_DATA_DIR` or
 * `MCP_BLOB_BASE_URL` set) whatever that flag says: a hosted runner's disk is
 * not the user's, so a file written there would be reported as downloaded while
 * nobody could ever open it. It returns images inline up to the result cap and,
 * when the host provides a blob store, the rest as one signed zip link.
 */
export function makeDownloadIO(env: EnvSource = process.env): DownloadIO {
  const inline = parseBoolEnv('ARTSONIA_INLINE_DOWNLOADS', { env });
  return inline || isHostedEnv(env)
    ? new InlineDownloadIO(MAX_INLINE_BYTES, { env })
    : new NodeDownloadIO(downloadRoots(env));
}
