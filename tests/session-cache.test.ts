import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CookieJar } from '@chrischall/mcp-utils';

import {
  sessionCachePath,
  createSessionCache,
  jarFromHeader,
  reportCacheWriteFailure,
} from '../src/session-cache.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'artsonia-cache-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const on = (over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  MCP_DATA_DIR: dir,
  ARTSONIA_USERNAME: 'parent@example.com',
  ARTSONIA_PASSWORD: 'pw1',
  ARTSONIA_SESSION_CACHE: 'true',
  ...over,
});

const record = (cookieHeader = 'ASPSESSIONID=abc; member=42') => ({
  session: { cookieHeader },
  sessionAt: Date.now(),
});

// One file PER USER now, so the helper has to mirror the sanitiser in
// session-cache.ts rather than assume a single session.json.
const cacheFile = (d: string, user = 'parent@example.com'): string =>
  join(d, '.artsonia-mcp', `session-${user.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '_')}.json`);

describe('jarFromHeader', () => {
  it('round-trips a live jar through its rendered header', () => {
    // The whole design rests on this: the live session holds a CookieJar, which
    // cannot be JSON round-tripped, so the stored form is header() and the jar
    // is rebuilt from it. CookieJar.absorb takes Set-Cookie, where attributes
    // are optional — so bare name=value pairs reproduce the jar.
    const jar = new CookieJar();
    jar.absorb(['ASPSESSIONID=abc123; path=/; HttpOnly', 'member=42; Path=/; Secure']);
    const restored = jarFromHeader(jar.header());
    expect(restored.header()).toBe(jar.header());
    expect(restored.get('member')).toBe('42');
    expect(restored.size).toBe(jar.size);
  });

  it('survives whitespace and a trailing separator', () => {
    const jar = jarFromHeader('  a=1 ;  b=2 ; ');
    expect(jar.get('a')).toBe('1');
    expect(jar.get('b')).toBe('2');
    expect(jar.size).toBe(2);
  });

  it('yields an empty jar for an empty header rather than a bogus cookie', () => {
    expect(jarFromHeader('').size).toBe(0);
  });
});

describe('sessionCachePath', () => {
  it('prefers MCP_DATA_DIR, the variable mcp-host injects', () => {
    expect(sessionCachePath({ MCP_DATA_DIR: '/data' })).toBe('/data/.artsonia-mcp/session.json');
  });

  it('honours an explicit ARTSONIA_SESSION_FILE', () => {
    expect(sessionCachePath({ ARTSONIA_SESSION_FILE: '/tmp/x.json', MCP_DATA_DIR: '/data' })).toBe(
      '/tmp/x.json',
    );
  });

  it('ignores a sentinel override rather than making a relative ./null', () => {
    expect(sessionCachePath({ ARTSONIA_SESSION_FILE: 'null', HOME: '/home/u' })).toBe(
      '/home/u/.artsonia-mcp/session.json',
    );
  });
});

describe('createSessionCache', () => {
  it('round-trips a session through a 0600 file', () => {
    createSessionCache({ env: on() })!.save(record());
    expect(statSync(cacheFile(dir)).mode & 0o777).toBe(0o600);
    expect(createSessionCache({ env: on() })!.load()?.session.cookieHeader).toBe(
      'ASPSESSIONID=abc; member=42',
    );
  });

  it.each([
    ['a rotated password', on({ ARTSONIA_PASSWORD: 'pw2' })],
    ['a different account', on({ ARTSONIA_USERNAME: 'other@example.com' })],
  ])('discards the cache on %s', (_label, env) => {
    createSessionCache({ env: on() })!.save(record());
    expect(createSessionCache({ env })!.load()).toBeNull();
  });

  it('matches the username case-insensitively', () => {
    createSessionCache({ env: on() })!.save(record());
    const cased = on({ ARTSONIA_USERNAME: '  Parent@Example.COM ' });
    expect(createSessionCache({ env: cased })!.load()).not.toBeNull();
  });

  it('writes no credential material to disk', () => {
    createSessionCache({ env: on() })!.save(record());
    const body = readFileSync(cacheFile(dir), 'utf8');
    expect(body).not.toContain('pw1');
    expect(body).not.toContain('parent@example.com');
  });

  it.each([
    ['the fetchproxy transport', on({ ARTSONIA_TRANSPORT: 'fetchproxy' }), {}],
    ['an explicit browserBacked flag', on(), { browserBacked: true }],
    ['ARTSONIA_SESSION_CACHE=false', on({ ARTSONIA_SESSION_CACHE: 'false' }), {}],
    ['no username', { MCP_DATA_DIR: dir, ARTSONIA_PASSWORD: 'pw' }, {}],
    ['no password', { MCP_DATA_DIR: dir, ARTSONIA_USERNAME: 'u' }, {}],
  ])('is disabled for %s', (_label, env, extra) => {
    expect(createSessionCache({ env, ...extra })).toBeNull();
  });

  it('still caches on the default (direct fetch) transport', () => {
    // The guard keys off the fetchproxy value specifically, so an unset or
    // explicit 'fetch' must NOT disable the cache.
    expect(createSessionCache({ env: on({ ARTSONIA_TRANSPORT: 'fetch' }) })).not.toBeNull();
    expect(createSessionCache({ env: on() })).not.toBeNull();
  });

  it('writes nothing at all when disabled', () => {
    expect(createSessionCache({ env: on({ ARTSONIA_SESSION_CACHE: 'false' }) })).toBeNull();
    expect(existsSync(join(dir, '.artsonia-mcp'))).toBe(false);
  });
});

describe('stored-record shape guard', () => {
  it.each([
    ['null', null],
    ['a primitive', 'nope'],
    ['a missing sessionAt', { session: { cookieHeader: 'a=1' } }],
    ['a primitive session', { session: 'nope', sessionAt: 1 }],
    ['a missing cookieHeader', { session: {}, sessionAt: 1 }],
    ['an EMPTY cookieHeader', { session: { cookieHeader: '' }, sessionAt: 1 }],
  ])('rejects %s rather than restoring an unusable session', (_label, body) => {
    // The empty case matters most: an empty jar would look authenticated and
    // then fail every request until the expiry heuristic caught it.
    const p = createSessionCache({ env: on() })!;
    p.save(record());
    // Swap only the STATE, keeping the envelope's salted binding intact —
    // overwriting the whole file would be rejected by the binding check before
    // the shape guard ever ran, which is the wrong reason to pass.
    const envelope = JSON.parse(readFileSync(cacheFile(dir), 'utf8')) as { state: unknown };
    envelope.state = body;
    writeFileSync(cacheFile(dir), JSON.stringify(envelope), { mode: 0o600 });
    expect(createSessionCache({ env: on() })!.load()).toBeNull();
  });
});

describe('reportCacheWriteFailure', () => {
  it.each([
    ['an Error', new Error('EROFS'), 'EROFS'],
    ['a non-Error', 'disk gone', 'disk gone'],
  ])('names the cause for %s and stays on stderr', (_label, thrown, expected) => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      reportCacheWriteFailure(thrown);
      expect(err).toHaveBeenCalledWith(expect.stringContaining(expected as string));
      // stdout is the JSON-RPC channel; a stray write there corrupts the stream.
      expect(out).not.toHaveBeenCalled();
    } finally {
      err.mockRestore();
      out.mockRestore();
    }
  });
});

describe('two users in one process', () => {
  it('each keeps its own record instead of clobbering the other', () => {
    // The bug this fixes: createDirectClient builds a client per credential set,
    // and one shared file meant each save overwrote the previous user's record —
    // which then failed its own binding check, so NEITHER ever got a hit.
    const a = { MCP_DATA_DIR: dir, ARTSONIA_SESSION_CACHE: 'true' };
    const alice = createSessionCache({ env: a, username: 'alice@example.com', password: 'pw' })!;
    const bob = createSessionCache({ env: a, username: 'bob@example.com', password: 'pw' })!;

    alice.save(record('SID=alice'));
    bob.save(record('SID=bob'));

    // Both survive, and each reads back its own.
    expect(alice.load()?.session.cookieHeader).toBe('SID=alice');
    expect(bob.load()?.session.cookieHeader).toBe('SID=bob');
  });

  it('still discards a record when that user rotates their password', () => {
    // Per-user paths must not cost the credential binding.
    const a = { MCP_DATA_DIR: dir, ARTSONIA_SESSION_CACHE: 'true' };
    createSessionCache({ env: a, username: 'alice@example.com', password: 'pw1' })!.save(record());
    const rotated = createSessionCache({ env: a, username: 'alice@example.com', password: 'pw2' })!;
    expect(rotated.load()).toBeNull();
  });

  it('an explicit ARTSONIA_SESSION_FILE still wins outright', () => {
    // A deployment that wants one file keeps it.
    const exact = join(dir, 'exact.json');
    const p = createSessionCache({
      env: { MCP_DATA_DIR: dir, ARTSONIA_SESSION_FILE: exact, ARTSONIA_SESSION_CACHE: 'true' },
      username: 'alice@example.com',
      password: 'pw',
    })!;
    p.save(record());
    expect(existsSync(exact)).toBe(true);
  });
});
