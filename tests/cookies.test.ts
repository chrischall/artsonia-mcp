import { describe, it, expect } from 'vitest';
import { CookieJar } from '@chrischall/mcp-utils';

// Contract tests for the SHARED CookieJar (@chrischall/mcp-utils), which
// replaced the local src/cookies.ts jar. They pin the behaviors artsonia's
// AuthManager depends on: name=value parsing into a Cookie header, last-wins
// overwrite, and deletion markers (Max-Age<=0 or a pre-2000 Expires — a
// superset of the old local jar's `value === '' && /1970/` check).
describe('CookieJar (shared, @chrischall/mcp-utils)', () => {
  it('parses name=value from Set-Cookie lines, ignoring attributes', () => {
    const jar = new CookieJar();
    jar.absorb([
      'ASPSESSIONID=abc123; path=/; HttpOnly',
      'AID=42; expires=Wed, 09 Jun 2027 10:18:14 GMT; path=/',
    ]);
    expect(jar.header()).toBe('ASPSESSIONID=abc123; AID=42');
    expect(jar.size).toBe(2);
    expect(jar.get('AID')).toBe('42');
  });

  it('later Set-Cookie for the same name overwrites the earlier value', () => {
    const jar = new CookieJar();
    jar.absorb(['SID=old; path=/']);
    jar.absorb(['SID=new; path=/']);
    expect(jar.header()).toBe('SID=new');
  });

  it('ignores blank / malformed lines and returns empty header when empty', () => {
    const jar = new CookieJar();
    jar.absorb(['', '   ', 'novalue']);
    expect(jar.header()).toBe('');
    expect(jar.size).toBe(0);
  });

  it('drops a cookie deleted via an epoch Expires (RFC 1123 format)', () => {
    const jar = new CookieJar();
    jar.absorb(['SID=real; path=/']);
    jar.absorb(['SID=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/']);
    expect(jar.size).toBe(0);
    expect(jar.get('SID')).toBeUndefined();
  });

  it('drops a cookie deleted via an epoch Expires (legacy dash format)', () => {
    const jar = new CookieJar();
    jar.absorb(['SID=real; path=/']);
    jar.absorb(['SID=deleted; expires=Thu, 01-Jan-1970 00:00:00 GMT; path=/']);
    expect(jar.size).toBe(0);
  });

  it('drops a cookie deleted via Max-Age=0 (no Expires needed)', () => {
    const jar = new CookieJar();
    jar.absorb(['SID=real; path=/']);
    jar.absorb(['SID=; Max-Age=0; path=/']);
    expect(jar.size).toBe(0);
  });
});
