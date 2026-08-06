import { parseBoolEnv } from '@chrischall/mcp-utils';
import type { DownloadIO } from './download.js';
import { NodeDownloadIO } from './download-io.js';
import { InlineDownloadIO } from './download-io-inline.js';

/**
 * Env-driven download-IO selector, the sibling of `makeTransport()`.
 *
 * Defaults to the disk-backed {@link NodeDownloadIO}: on a local stdio install
 * the server's filesystem IS the user's, so writing `dest` is exactly right and
 * must stay the default (silently switching would stop files appearing on disk).
 *
 * `ARTSONIA_INLINE_DOWNLOADS=1` selects the filesystem-free
 * {@link InlineDownloadIO}, for a HOSTED deployment where the "filesystem" is the
 * runner's disk and the user can never reach it — there, returning the artwork as
 * inline base64 image blocks is the only way the bytes reach the caller at all.
 *
 * Both implementations are cheap and side-effect free to construct, so unlike
 * `makeTransport()` this needs no dynamic import.
 */
export function makeDownloadIO(): DownloadIO {
  return parseBoolEnv('ARTSONIA_INLINE_DOWNLOADS') ? new InlineDownloadIO() : new NodeDownloadIO();
}
