import {
  createFileStatePersistence,
  resolveStateFile,
  type PersistedCookieSession,
  type SyncStatePersistence,
} from '@chrischall/mcp-utils/session';
import { readEnvVar, parseBoolEnv, CookieJar } from '@chrischall/mcp-utils';

/**
 * What actually goes on disk.
 *
 * The live session is `{ jar: CookieJar }` — a class instance with private
 * state, which cannot be JSON round-tripped. So the stored form is the jar's
 * rendered `Cookie` header, and {@link jarFromHeader} rebuilds a jar from it.
 * `CookieJar.absorb` parses `name=value` with attributes optional, so feeding
 * the header's pairs back in reproduces the jar exactly — verified rather than
 * assumed, and pinned by a test.
 */
export interface StoredArtsoniaSession {
  cookieHeader: string;
}

/**
 * Reduce a username to something safe to put in a file name.
 *
 * Not a digest: the file lives 0600 inside a 0700 directory, and an unsalted
 * digest of a credential-adjacent value is the kind of precomputable artifact
 * the mcp-utils review rightly objected to. A sanitised login is readable by
 * the operator who already knows it and no more revealing than the directory.
 */
function fileSegment(username: string): string {
  const safe = username.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '_');
  return safe === '' ? 'default' : safe.slice(0, 64);
}

/**
 * Where the signed-in session is cached between runs.
 *
 * PER USER, which is load-bearing rather than tidy: `createDirectClient` builds
 * a client per set of credentials, and one shared file meant each user's save
 * clobbered the previous one — every record then failing its own binding check,
 * so nobody ever got a cache hit and the file thrashed. An explicit
 * ARTSONIA_SESSION_FILE still wins outright, for a deployment that wants one.
 */
export function sessionCachePath(
  env: NodeJS.ProcessEnv = process.env,
  username?: string | null,
): string {
  return resolveStateFile({
    env,
    envVar: 'ARTSONIA_SESSION_FILE',
    subdir: '.artsonia-mcp',
    fileName: username ? `session-${fileSegment(username)}.json` : 'session.json',
  });
}

/** Rebuild a live jar from a stored `Cookie` header. */
export function jarFromHeader(header: string): CookieJar {
  const jar = new CookieJar();
  const pairs = header
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p !== '');
  if (pairs.length > 0) jar.absorb(pairs);
  return jar;
}

/** Guard the stored envelope: a non-empty cookie header, and a login time. */
function isStored(raw: unknown): raw is PersistedCookieSession<StoredArtsoniaSession> {
  if (raw === null || typeof raw !== 'object') return false;
  const r = raw as Partial<PersistedCookieSession<StoredArtsoniaSession>>;
  if (typeof r.sessionAt !== 'number') return false;
  const s = r.session as Partial<StoredArtsoniaSession> | undefined;
  if (s === null || typeof s !== 'object') return false;
  // An empty header is not a session — restoring one would look authenticated
  // and then fail every request until the expiry heuristic caught it.
  return typeof s.cookieHeader === 'string' && s.cookieHeader !== '';
}

/** Options for {@link createSessionCache}. */
export interface SessionCacheOptions {
  env?: NodeJS.ProcessEnv;
  /**
   * The credentials actually in use. AuthManager accepts them via `opts` as
   * well as from the environment, and binding to the env pair when the caller
   * passed different ones would be wrong twice over: a per-user client built
   * with explicit credentials would silently never cache, and if it did it
   * would be keyed to somebody else's. Falls back to the env when omitted.
   */
  username?: string | null;
  password?: string | null;
  /**
   * True when requests run over the fetchproxy browser bridge rather than
   * direct fetch. That transport authenticates from a signed-in tab, so there
   * is no server-held cookie jar worth persisting.
   */
  browserBacked?: boolean;
}

/**
 * The session cache, or `null` when it must not be used.
 *
 * Artsonia's login is a real form POST against a classic server-rendered site,
 * and a hosted child idles out after ten minutes — so most starts were
 * re-running it. Caching the jar makes those starts free; an expired cookie
 * still costs what it did, because `looksUnauthenticated` catches it on the
 * first request and the manager re-logs-in and replays.
 *
 * Bound to the credentials that minted it, so rotating either discards the
 * record. Only a salted digest is written; neither value reaches the file.
 */
export function createSessionCache(
  opts: SessionCacheOptions = {},
): SyncStatePersistence<PersistedCookieSession<StoredArtsoniaSession>> | null {
  const env = opts.env ?? process.env;
  // The bridge transport authenticates from a signed-in browser tab, so there
  // is no server-held jar worth persisting. Read here rather than passed in, so
  // it cannot drift from the selector in make-transport.ts.
  if (opts.browserBacked === true) return null;
  if (readEnvVar('ARTSONIA_TRANSPORT', { env }) === 'fetchproxy') return null;
  if (!parseBoolEnv('ARTSONIA_SESSION_CACHE', { env, default: true })) return null;
  const username = opts.username ?? readEnvVar('ARTSONIA_USERNAME', { env });
  const password = opts.password ?? readEnvVar('ARTSONIA_PASSWORD', { env });
  if (!username || !password) return null;

  return createFileStatePersistence<PersistedCookieSession<StoredArtsoniaSession>>({
    filePath: sessionCachePath(env, username),
    // Joined on a NUL, written as an escape rather than a literal byte: a
    // password may contain spaces, so a space-joined pair could collide with a
    // different pair by shifting the boundary between the two halves.
    boundTo: [username.trim().toLowerCase(), password].join('\u0000'),
    validate: (raw) => (isStored(raw) ? raw : null),
  });
}

/**
 * Report a cache write that failed. Not fatal: the session is re-mintable from
 * the credentials in the environment, so a lost write costs the next start a
 * login rather than access. Worth saying, though — a read-only data dir
 * otherwise looks exactly like a server that never caches.
 *
 * stderr only; stdout is the JSON-RPC channel.
 */
export function reportCacheWriteFailure(err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err);
  console.error(
    `[artsonia-mcp] could not cache the session (${detail}); continuing without the ` +
      'cache — every restart will log in again until this is fixed.',
  );
}
